// Copyright (c) 2010-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
//
// See https://wiki.mozilla.org/Extension_Manager:Bootstrapped_Extensions
// for details.

const NAME = "bootstrap";
const global = this;

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const Cr = Components.results;

Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

const resourceProto = Services.io.getProtocolHandler("resource")
                              .QueryInterface(Ci.nsIResProtocolHandler);
const categoryManager = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
const manager = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
const storage = Cc["@mozilla.org/fuel/application;1"].getService(Ci.fuelIApplication).storage;
let JSMLoader = storage.get("dactyl.JSMLoader", undefined);

function reportError(e) {
    dump("dactyl: bootstrap: " + e + "\n" + (e.stack || Error().stack));
    Cu.reportError(e);
}

function httpGet(url) {
    let xmlhttp = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
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
storage.set("dactyl.bootstrap", this);

function updateVersion() {
    try {
        function isDev(ver) /^hg|pre$/.test(ver);
        if (typeof require === "undefined" || addon === addonData)
            return;

        require(global, "config");
        require(global, "prefs");
        config.lastVersion = localPrefs.get("lastVersion", null);

        localPrefs.set("lastVersion", addon.version);

        if (!config.lastVersion || isDev(config.lastVersion) != isDev(addon.version))
            addon.applyBackgroundUpdates = AddonManager[isDev(addon.version) ? "AUTOUPDATE_DISABLE" : "AUTOUPDATE_DEFAULT"];
    }
    catch (e) {
        reportError(e);
    }
}

function startup(data, reason) {
    dump("dactyl: bootstrap: startup " + reasonToString(reason) + "\n");
    basePath = data.installPath;

    if (!initialized) {
        initialized = true;

        dump("dactyl: bootstrap: init" + " " + data.id + "\n");

        addonData = data;
        addon = data;
        AddonManager.getAddonByID(addon.id, function (a) {
            addon = a;
            updateVersion();
        });

        if (basePath.isDirectory())
            getURI = function getURI(path) {
                let file = basePath.clone().QueryInterface(Ci.nsILocalFile);
                file.appendRelativePath(path);
                return Services.io.newFileURI(file);
            };
        else
            getURI = function getURI(path)
                Services.io.newURI("jar:" + Services.io.newFileURI(basePath).spec + "!/" + path, null, null);
        try {
            init();
        }
        catch (e) {
            reportError(e);
        }
    }
}

function FactoryProxy(url, classID) {
    this.url = url;
    this.classID = Components.ID(classID);
}
FactoryProxy.prototype = {
    QueryInterface: XPCOMUtils.generateQI(Ci.nsIFactory),
    register: function () {
        dump("dactyl: bootstrap: register: " + this.classID + " " + this.contractID + "\n");

        JSMLoader.registerFactory(this);
    },
    get module() {
        dump("dactyl: bootstrap: create module: " + this.contractID + "\n");

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
    dump("dactyl: bootstrap: init\n");

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
            resources.push(fields[1], fields[1] + suffix);
            resourceProto.setSubstitution(fields[1], getURI(fields[2]));
            resourceProto.setSubstitution(fields[1] + suffix, getURI(fields[2]));
        }
    }

    if (JSMLoader && JSMLoader.bump != 3) // Temporary hack
        Services.scriptloader.loadSubScript("resource://dactyl" + suffix + "/bootstrap.jsm",
            Cu.import("resource://dactyl/bootstrap.jsm", global));

    if (!JSMLoader || JSMLoader.bump != 3)
        Cu.import("resource://dactyl/bootstrap.jsm", global);

    JSMLoader.load("resource://dactyl/bootstrap.jsm", global);

    JSMLoader.init(suffix);
    JSMLoader.load("base.jsm", global);

    for each (let component in components)
        component.register();

    Services.obs.notifyObservers(null, "dactyl-rehash", null);
    updateVersion();
    require(global, "overlay");
}

function shutdown(data, reason) {
    dump("dactyl: bootstrap: shutdown " + reasonToString(reason) + "\n");
    if (reason != APP_SHUTDOWN) {
        if ([ADDON_UPGRADE, ADDON_DOWNGRADE, ADDON_UNINSTALL].indexOf(reason) >= 0)
            Services.obs.notifyObservers(null, "dactyl-purge", null);

        Services.obs.notifyObservers(null, "dactyl-cleanup", null);
        Services.obs.notifyObservers(null, "dactyl-cleanup-modules", null);

        JSMLoader.purge();
        for each (let [category, entry] in categories)
            categoryManager.deleteCategoryEntry(category, entry, false);
        for each (let resource in resources)
            resourceProto.setSubstitution(resource, null);
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

function install(data, reason) { dump("dactyl: bootstrap: install " + reasonToString(reason) + "\n"); }
function uninstall(data, reason) { dump("dactyl: bootstrap: uninstall " + reasonToString(reason) + "\n"); }

// vim: set fdm=marker sw=4 ts=4 et:
