// Copyright (c) 2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

var EXPORTED_SYMBOLS = ["JSMLoader"];

var BOOTSTRAP_CONTRACT = "@dactyl.googlecode.com/base/bootstrap";
var JSMLoader = BOOTSTRAP_CONTRACT in Components.classes &&
    Components.classes[BOOTSTRAP_CONTRACT].getService().wrappedJSObject.loader;

if (JSMLoader && JSMLoader.bump === 4)
    JSMLoader.global = this;
else
    JSMLoader = {
        bump: 4,
        builtin: Components.utils.Sandbox(this),
        canonical: {},
        factories: [],
        global: this,
        globals: JSMLoader ? JSMLoader.globals : {},
        io: Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService),
        loader: Components.classes["@mozilla.org/moz/jssubscript-loader;1"].getService(Components.interfaces.mozIJSSubScriptLoader),
        manager: Components.manager.QueryInterface(Components.interfaces.nsIComponentRegistrar),
        stale: JSMLoader ? JSMLoader.stale : {},
        suffix: "",
        init: function init(suffix) {
            this.initialized = true;
            this.suffix = suffix || "";

            let base = this.load("base.jsm", this.global);
            this.global.EXPORTED_SYMBOLS = base.EXPORTED_SYMBOLS;
            this.global.JSMLoader = this;
            base.JSMLoader = this;
        },
        getTarget: function getTarget(url) {
            if (url.indexOf(":") === -1)
                url = "resource://dactyl" + this.suffix + "/" + url;

            let chan = this.io.newChannel(url, null, null);
            chan.cancel(Components.results.NS_BINDING_ABORTED);
            return chan.name;
        },
        load: function load(name, target) {
            let url = name;
            if (url.indexOf(":") === -1)
                url = "resource://dactyl" + this.suffix + "/" + url;
            let targetURL = this.getTarget(url);

            let stale = this.stale[name] || this.stale[targetURL];
            if (stale) {
                delete this.stale[name];
                delete this.stale[targetURL];

                let loadURL = url.replace(RegExp("^(resource://dactyl)/"), "$1" + this.suffix + "/");

                let global = this.globals[name];
                if (stale === targetURL)
                    this.loadSubScript(loadURL, global.global || global);
            }

            try {
                let global = Components.utils.import(url, target);
                return this.globals[name] = global;
            }
            catch (e) {
                dump("Importing " + url + ": " + e + "\n" + (e.stack || Error().stack));
                throw e;
            }
        },
        loadSubScript: function loadSubScript() this.loader.loadSubScript.apply(this.loader, arguments),
        cleanup: function unregister() {
            for each (let factory in this.factories.splice(0))
                this.manager.unregisterFactory(factory.classID, factory);
        },
        purge: function purge() {
            dump("dactyl: JSMLoader: purge\n");

            for (let [url, global] in Iterator(this.globals)) {
                if (url === "bootstrap.jsm" || url === "resource://dactyl/bootstrap.jsm")
                    continue;

                let target = this.getTarget(url);
                this.stale[url] = target;
                this.stale[target] = target;

                for each (let prop in Object.getOwnPropertyNames(global))
                    try {
                        if (!(prop in this.builtin) &&
                            ["JSMLoader", "set", "EXPORTED_SYMBOLS"].indexOf(prop) < 0 &&
                            !global.__lookupGetter__(prop))
                            global[prop] = undefined;
                    }
                    catch (e) {
                        dump("Deleting property " + prop + " on " + url + ":\n    " + e + "\n");
                        Components.utils.reportError(e);
                    }
            }
        },

        registerFactory: function registerFactory(factory) {
            this.manager.registerFactory(factory.classID,
                                         String(factory.classID),
                                         factory.contractID,
                                         factory);
            this.factories.push(factory);
        }
    };

}catch(e){ dump(e + "\n" + (e.stack || Error().stack)); Components.utils.reportError(e) }

