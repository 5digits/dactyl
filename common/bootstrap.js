// Copyright (c) 2010-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
//
// See https://wiki.mozilla.org/Extension_Manager:Bootstrapped_Extensions
// for details.

const NAME = "bootstrap";
const global = this;

var { classes: Cc, interfaces: Ci, results: Cr, utils: Cu } = Components;

function module(uri) {
    let obj = {};
    Cu.import(uri, obj);
    return obj;
}

const { AddonManager } = module("resource://gre/modules/AddonManager.jsm");
const { XPCOMUtils }   = module("resource://gre/modules/XPCOMUtils.jsm");
const { Services }     = module("resource://gre/modules/Services.jsm");

const resourceProto = Services.io.getProtocolHandler("resource")
                              .QueryInterface(Ci.nsIResProtocolHandler);
const categoryManager = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
const manager = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);

const DISABLE_ACR        = "resource://dactyl-content/disable-acr.jsm";
const BOOTSTRAP_JSM      = "resource://dactyl/bootstrap.jsm";
const BOOTSTRAP_CONTRACT = "@dactyl.googlecode.com/base/bootstrap";

var JSMLoader = BOOTSTRAP_CONTRACT in Cc && Cc[BOOTSTRAP_CONTRACT].getService().wrappedJSObject.loader;
var name = "dactyl";

function reportError(e) {
    dump("\n" + name + ": bootstrap: " + e + "\n" + (e.stack || Error().stack) + "\n");
    Cu.reportError(e);
}
function debug(msg) {
    dump(name + ": " + msg + "\n");
}

function httpGet(url) {
    let xmlhttp = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
    xmlhttp.overrideMimeType("text/plain");
    xmlhttp.open("GET", url, false);
    xmlhttp.send(null);
    return xmlhttp;
}

let initialized = false;
let addon = null;
let addonData = null;
let basePath = null;
let categories = [];
let components = {};
let resources = [];
let getURI = null;

function updateLoader() {
    try {
        JSMLoader.loader = Cc["@dactyl.googlecode.com/extra/utils"].getService(Ci.dactylIUtils);
    }
    catch (e) {};
}

/**
 * Performs necessary migrations after a version change.
 */
function updateVersion() {
    try {
        function isDev(ver) /^hg|pre$/.test(ver);
        if (typeof require === "undefined" || addon === addonData)
            return;

        require(global, "config");
        require(global, "prefs");
        config.lastVersion = localPrefs.get("lastVersion", null);

        localPrefs.set("lastVersion", addon.version);

        // We're switching from a nightly version to a stable or
        // semi-stable version or vice versa.
        //
        // Disable automatic updates when switching to nightlies,
        // restore the default action when switching to stable.
        if (!config.lastVersion || isDev(config.lastVersion) != isDev(addon.version))
            addon.applyBackgroundUpdates = AddonManager[isDev(addon.version) ? "AUTOUPDATE_DISABLE" : "AUTOUPDATE_DEFAULT"];
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

        debug("bootstrap: init" + " " + data.id);

        addonData = data;
        addon = data;
        name = data.id.replace(/@.*/, "");
        AddonManager.getAddonByID(addon.id, function (a) {
            addon = a;

            updateLoader();
            updateVersion();
            if (typeof require !== "undefined")
                require(global, "main");
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
function FactoryProxy(url, classID) {
    this.url = url;
    this.classID = Components.ID(classID);
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

function init() {
    debug("bootstrap: init");

    let manifestURI = getURI("chrome.manifest");
    let manifest = httpGet(manifestURI.spec)
            .responseText
            .replace(/^\s*|\s*$|#.*/g, "")
            .replace(/^\s*\n/gm, "");

    let suffix = "-";
    let chars = "0123456789abcdefghijklmnopqrstuv";
    for (let n = Date.now(); n; n = Math.round(n / chars.length))
        suffix += chars[n % chars.length];

    for each (let line in manifest.split("\n")) {
        let fields = line.split(/\s+/);
        switch(fields[0]) {
        case "category":
            categoryManager.addCategoryEntry(fields[1], fields[2], fields[3], false, true);
            categories.push([fields[1], fields[2]]);
            break;
        case "component":
            components[fields[1]] = new FactoryProxy(getURI(fields[2]).spec, fields[1]);
            break;
        case "contract":
            components[fields[2]].contractID = fields[1];
            break;

        case "resource":
            var hardSuffix = /^[^\/]*/.exec(fields[2])[0];

            resources.push(fields[1], fields[1] + suffix);
            resourceProto.setSubstitution(fields[1], getURI(fields[2]));
            resourceProto.setSubstitution(fields[1] + suffix, getURI(fields[2]));
        }
    }

    // Flush the cache if necessary, just to be paranoid
    let pref = "extensions.dactyl.cacheFlushCheck";
    let val  = addon.version + "-" + hardSuffix;
    if (!Services.prefs.prefHasUserValue(pref) || Services.prefs.getCharPref(pref) != val) {
        Services.obs.notifyObservers(null, "startupcache-invalidate", "");
        Services.prefs.setCharPref(pref, val);
    }

    try {
        module(DISABLE_ACR).init(addon.id);
    }
    catch (e) {
        reportError(e);
    }

    if (JSMLoader) {
        // Temporary hacks until platforms and dactyl releases that don't
        // support Cu.unload are phased out.
        if (Cu.unload) {
            // Upgrading from dactyl release without Cu.unload support.
            Cu.unload(BOOTSTRAP_JSM);
            for (let [name] in Iterator(JSMLoader.globals))
                Cu.unload(~name.indexOf(":") ? name : "resource://dactyl" + JSMLoader.suffix + "/" + name);
        }
        else if (JSMLoader.bump != 6) {
            // We're in a version without Cu.unload support and the
            // JSMLoader interface has changed. Bump off the old one.
            Services.scriptloader.loadSubScript("resource://dactyl" + suffix + "/bootstrap.jsm",
                Cu.import(BOOTSTRAP_JSM, global));
        }
    }

    if (!JSMLoader || JSMLoader.bump !== 6 || Cu.unload)
        Cu.import(BOOTSTRAP_JSM, global);

    JSMLoader.name = name;
    JSMLoader.bootstrap = this;

    JSMLoader.load(BOOTSTRAP_JSM, global);

    JSMLoader.init(suffix);
    JSMLoader.load("base.jsm", global);

    if (!(BOOTSTRAP_CONTRACT in Cc)) {
        // Use Sandbox to prevent closures over this scope
        let sandbox = Cu.Sandbox(Cc["@mozilla.org/systemprincipal;1"].getService());
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

    Services.obs.notifyObservers(null, "dactyl-rehash", null);
    updateVersion();

    updateLoader();
    if (addon !== addonData)
        require(global, "main");
}

function shutdown(data, reason) {
    debug("bootstrap: shutdown " + reasonToString(reason));
    if (reason != APP_SHUTDOWN) {
        try {
            module(DISABLE_ACR).cleanup();
            if (Cu.unload)
                Cu.unload(DISABLE_ACR);
        }
        catch (e) {
            reportError(e);
        }

        if (~[ADDON_UPGRADE, ADDON_DOWNGRADE, ADDON_UNINSTALL].indexOf(reason))
            Services.obs.notifyObservers(null, "dactyl-purge", null);

        Services.obs.notifyObservers(null, "dactyl-cleanup", reasonToString(reason));
        Services.obs.notifyObservers(null, "dactyl-cleanup-modules", reasonToString(reason));

        JSMLoader.purge();
        for each (let [category, entry] in categories)
            categoryManager.deleteCategoryEntry(category, entry, false);
        for each (let resource in resources)
            resourceProto.setSubstitution(resource, null);
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
