// Copyright (c) 2010-2014 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
//
// See https://wiki.mozilla.org/Extension_Manager:Bootstrapped_Extensions
// for details.
"use strict";

const global = this;

var { classes: Cc, interfaces: Ci, results: Cr, utils: Cu } = Components;

function module(uri) Cu.import(uri, {});

const DEBUG = true;

__defineGetter__("BOOTSTRAP", () => "resource://" + moduleName + "/bootstrap.jsm");

var { AddonManager } = module("resource://gre/modules/AddonManager.jsm");
var { XPCOMUtils }   = module("resource://gre/modules/XPCOMUtils.jsm");
var { Services }     = module("resource://gre/modules/Services.jsm");

var Timer = Components.Constructor("@mozilla.org/timer;1", "nsITimer", "initWithCallback");

const resourceProto = Services.io.getProtocolHandler("resource")
                              .QueryInterface(Ci.nsIResProtocolHandler);
const categoryManager = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
const manager = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);

const BOOTSTRAP_CONTRACT = "@dactyl.googlecode.com/base/bootstrap";

var name = "dactyl";

function reportError(e) {
    let stack = e.stack || Error().stack;
    dump("\n" + name + ": bootstrap: " + e + "\n" + stack + "\n");
    Cu.reportError(e);
    Cc["@mozilla.org/consoleservice;1"].getService(Ci.nsIConsoleService)
                                       .logStringMessage(stack);
}
function debug(...args) {
    if (DEBUG)
        dump(name + ": " + args.join(", ") + "\n");
}

function httpGet(uri) {
    let xmlhttp = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
    xmlhttp.overrideMimeType("text/plain");
    xmlhttp.open("GET", uri.spec || uri, false);
    xmlhttp.send(null);
    return xmlhttp;
}

let moduleName;
let initialized = false;
let addon = null;
let addonData = null;
let basePath = null;
let bootstrap;
let bootstrap_jsm;
let components = {};
let getURI = null;

let JSMLoader = {
    SANDBOX: Cu.nukeSandbox,

    get addon() addon,

    currentModule: null,

    factories: [],

    get name() name,

    get module() moduleName,

    globals: {},
    modules: {},

    times: {
        all: 0,
        add: function add(major, minor, delta) {
            this.all += delta;

            this[major] = (this[major] || 0) + delta;
            if (minor) {
                minor = ":" + minor;
                this[minor] = (this[minor] || 0) + delta;
                this[major + minor] = (this[major + minor] || 0) + delta;
            }
        },
        clear: function clear() {
            for (let key in this)
                if (typeof this[key] !== "number")
                    delete this[key];
        }
    },

    getTarget: function getTarget(url) {
        let uri = Services.io.newURI(url, null, null);
        if (uri.schemeIs("resource"))
            return resourceProto.resolveURI(uri);

        let chan = Services.io.newChannelFromURI(uri);
        try { chan.cancel(Cr.NS_BINDING_ABORTED); } catch (e) {}
        return chan.name;
    },

    _atexit: [],

    atexit: function atexit(arg, self) {
        if (typeof arg !== "string")
            this._atexit.push(arguments);
        else
            for each (let [fn, self] in this._atexit)
                try {
                    fn.call(self, arg);
                }
                catch (e) {
                    reportError(e);
                }
    },

    _load: function _load(name, target) {
        let urls = [name];
        if (name.indexOf(":") === -1)
            urls = this.config["module-paths"].map(path => path + name + ".jsm");

        for each (let url in urls)
            try {
                var uri = this.getTarget(url);
                if (uri in this.globals)
                    return this.modules[name] = this.globals[uri];

                this.globals[uri] = this.modules[name];
                bootstrap_jsm.loadSubScript(url, this.modules[name], "UTF-8");
                return;
            }
            catch (e) {
                debug("Loading " + name + ": " + e);
                delete this.globals[uri];

                if (typeof e != "string")
                    throw e;
            }

        throw Error("No such module: " + name);
    },

    load: function load(name, target) {
        if (!this.modules.hasOwnProperty(name)) {
            this.modules[name] = this.modules.base ? bootstrap.create(this.modules.base)
                                                   : bootstrap.import({ JSMLoader: this, module: global.module });

            let currentModule = this.currentModule;
            this.currentModule = this.modules[name];

            try {
                this._load(name, this.modules[name]);
            }
            catch (e) {
                delete this.modules[name];
                reportError(e);
                throw e;
            }
            finally {
                this.currentModule = currentModule;
            }
        }

        let module = this.modules[name];
        if (target)
            for each (let symbol in module.EXPORTED_SYMBOLS)
                try {
                    Object.defineProperty(target, symbol, {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: module[symbol]
                    });
                }
                catch (e) {
                    target[symbol] = module[symbol];
                }

        return module;
    },

    // Cuts down on stupid, fscking url mangling.
    get loadSubScript() bootstrap_jsm.loadSubScript,

    cleanup: function cleanup() {
        for (let factory of this.factories.splice(0))
            manager.unregisterFactory(factory.classID, factory);
    },

    Factory: function Factory(class_) ({
        __proto__: class_.prototype,

        createInstance: function (outer, iid) {
            try {
                if (outer != null)
                    throw Cr.NS_ERROR_NO_AGGREGATION;
                if (!class_.instance)
                    class_.instance = new class_();
                return class_.instance.QueryInterface(iid);
            }
            catch (e) {
                Cu.reportError(e);
                throw e;
            }
        }
    }),

    registerFactory: function registerFactory(factory) {
        manager.registerFactory(factory.classID,
                                String(factory.classID),
                                factory.contractID,
                                factory);
        this.factories.push(factory);
    }
};

function init() {
    debug("bootstrap: init");

    let manifest = JSON.parse(httpGet(getURI("config.json"))
                                .responseText);

    if (!manifest.categories)
        manifest.categories = [];

    for (let [classID, { contract, path, categories }] of Iterator(manifest.components || {})) {
        components[classID] = new FactoryProxy(getURI(path).spec, classID, contract);
        if (categories)
            for (let [category, id] in Iterator(categories))
                manifest.categories.push([category, id, contract]);
    }

    for (let [category, id, value] of manifest.categories)
        categoryManager.addCategoryEntry(category, id, value,
                                         false, true);

    for (let [pkg, path] in Iterator(manifest.resources || {})) {
        moduleName = moduleName || pkg;
        resourceProto.setSubstitution(pkg, getURI(path));
    }

    JSMLoader.config = manifest;

    bootstrap_jsm = module(BOOTSTRAP);
    if (!JSMLoader.SANDBOX)
        bootstrap = bootstrap_jsm;
    else {
        bootstrap = Cu.Sandbox(Cc["@mozilla.org/systemprincipal;1"].createInstance(),
                               { sandboxName: BOOTSTRAP,
                                 metadata: { addonID: addon.id } });
        Services.scriptloader.loadSubScript(BOOTSTRAP, bootstrap);
    }
    bootstrap.require = JSMLoader.load("base").require;

    let pref = "extensions.dactyl.cacheFlushCheck";
    let val  = addon.version;
    if (!Services.prefs.prefHasUserValue(pref) || Services.prefs.getCharPref(pref) != val) {
        var cacheFlush = true;
        Services.prefs.setCharPref(pref, val);
    }

    Services.obs.notifyObservers(null, "dactyl-rehash", null);

    JSMLoader.bootstrap = global;

    JSMLoader.load("config", global);
    JSMLoader.load("main", global);

    JSMLoader.cacheFlush = cacheFlush;
    JSMLoader.load("base", global);

    if (!(BOOTSTRAP_CONTRACT in Cc)) {
        // Use Sandbox to prevent closures over this scope
        let sandbox = Cu.Sandbox(Cc["@mozilla.org/systemprincipal;1"].createInstance());
        let factory = Cu.evalInSandbox("({ createInstance: function () this })", sandbox);

        factory.classID         = Components.ID("{f541c8b0-fe26-4621-a30b-e77d21721fb5}");
        factory.contractID      = BOOTSTRAP_CONTRACT;
        factory.QueryInterface  = XPCOMUtils.generateQI([Ci.nsIFactory]);
        factory.wrappedJSObject = factory;

        manager.registerFactory(factory.classID, String(factory.classID),
                                BOOTSTRAP_CONTRACT, factory);
    }

    Cc[BOOTSTRAP_CONTRACT].getService().wrappedJSObject.loader = !Cu.unload && JSMLoader;

    for each (let component in components)
        component.register();

    updateVersion();

    if (addon !== addonData)
        require("main", global);
}

/**
 * Performs necessary migrations after a version change.
 */
function updateVersion() {
    function isDev(ver) /^hg|pre$/.test(ver);
    try {
        if (typeof require === "undefined" || addon === addonData)
            return;

        JSMLoader.load("prefs", global);
        config.lastVersion = localPrefs.get("lastVersion", null);

        localPrefs.set("lastVersion", addon.version);

        // We're switching from a nightly version to a stable or
        // semi-stable version or vice versa.
        //
        // Disable automatic updates when switching to nightlies,
        // restore the default action when switching to stable.
        if (!config.lastVersion || isDev(config.lastVersion) != isDev(addon.version))
            addon.applyBackgroundUpdates =
                AddonManager[isDev(addon.version) ? "AUTOUPDATE_DISABLE"
                                                  : "AUTOUPDATE_DEFAULT"];
    }
    catch (e) {
        reportError(e);
    }
}

function startup(data, reason) {
    debug("bootstrap: startup " + reasonToString(reason));
    basePath = data.installPath;

    if (!initialized) {
        initialized = true;

        debug("bootstrap: init " + data.id);

        addonData = data;
        addon = data;
        name = data.id.replace(/@.*/, "");
        AddonManager.getAddonByID(addon.id, function (a) {
            addon = a;

            updateVersion();
            if (typeof require !== "undefined")
                require("main", global);
        });

        if (basePath.isDirectory())
            getURI = function getURI(path) {
                let uri = Services.io.newFileURI(basePath);
                uri.path += path;
                return Services.io.newFileURI(uri.QueryInterface(Ci.nsIFileURL).file);
            };
        else
            getURI = function getURI(path)
                Services.io.newURI("jar:" + Services.io.newFileURI(basePath).spec.replace(/!/g, "%21") + "!" +
                                   "/" + path, null, null);

        try {
            init();
        }
        catch (e) {
            reportError(e);
        }
    }
}

/**
 * An XPCOM class factory proxy. Loads the JavaScript module at *url*
 * when an instance is to be created and calls its NSGetFactory method
 * to obtain the actual factory.
 *
 * @param {string} url The URL of the module housing the real factory.
 * @param {string} classID The CID of the class this factory represents.
 */
function FactoryProxy(url, classID, contractID) {
    this.url = url;
    this.classID = Components.ID(classID);
    this.contractID = contractID;
}
FactoryProxy.prototype = {
    QueryInterface: XPCOMUtils.generateQI(Ci.nsIFactory),
    register: function () {
        debug("bootstrap: register: " + this.classID + " " + this.contractID);

        JSMLoader.registerFactory(this);
    },
    get module() {
        debug("bootstrap: create module: " + this.contractID);

        Object.defineProperty(this, "module", { value: {}, enumerable: true });
        JSMLoader.load(this.url, this.module);
        return this.module;
    },
    createInstance: function (iids) {
        return let (factory = this.module.NSGetFactory(this.classID))
            factory.createInstance.apply(factory, arguments);
    }
}

var timer;
function shutdown(data, reason) {
    let strReason = reasonToString(reason);
    debug("bootstrap: shutdown " + strReason);

    if (reason != APP_SHUTDOWN) {
        if (~[ADDON_UPGRADE, ADDON_DOWNGRADE, ADDON_UNINSTALL].indexOf(reason))
            Services.obs.notifyObservers(null, "dactyl-purge", null);

        Services.obs.notifyObservers(null, "dactyl-cleanup", strReason);
        Services.obs.notifyObservers(null, "dactyl-cleanup-modules", reasonToString(reason));

        JSMLoader.atexit(strReason);
        JSMLoader.cleanup(strReason);

        for each (let [category, entry] in JSMLoader.config.categories)
            categoryManager.deleteCategoryEntry(category, entry, false);
        for (let resource in JSMLoader.config.resources)
            resourceProto.setSubstitution(resource, null);

        timer = Timer(() => {
            bootstrap_jsm.require = null;
            if (JSMLoader.SANDBOX)
                Cu.nukeSandbox(bootstrap);
            else
                Cu.unload(BOOTSTRAP);
            bootstrap = null;
            bootstrap_jsm = null;
        }, 5000, Ci.nsITimer.TYPE_ONE_SHOT);
    }
}

function uninstall(data, reason) {
    debug("bootstrap: uninstall " + reasonToString(reason));
    if (reason == ADDON_UNINSTALL) {
        Services.prefs.deleteBranch("extensions.dactyl.");

        if (BOOTSTRAP_CONTRACT in Cc) {
            let service = Cc[BOOTSTRAP_CONTRACT].getService().wrappedJSObject;
            manager.unregisterFactory(service.classID, service);
        }
    }
}

function reasonToString(reason) {
    for each (let name in ["disable", "downgrade", "enable",
                           "install", "shutdown", "startup",
                           "uninstall", "upgrade"])
        if (reason == global["ADDON_" + name.toUpperCase()] ||
            reason == global["APP_" + name.toUpperCase()])
            return name;
}

function install(data, reason) { debug("bootstrap: install " + reasonToString(reason)); }

// vim: set fdm=marker sw=4 ts=4 et:
