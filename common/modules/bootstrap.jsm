// Copyright (c) 2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {
dump("=========== load bootstrap.jsm ===========\n");

if (!JSMLoader || JSMLoader.bump != 1)
    var JSMLoader = {
        global: this,
        bump: 1,
        builtin: Components.utils.Sandbox(this),
        canonical: {},
        factories: [],
        globals: {},
        io: Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService),
        manager: Components.manager.QueryInterface(Components.interfaces.nsIComponentRegistrar),
        stale: {},
        suffix: "",
        getTarget: function getTarget(url) {
            let chan = this.io.newChannel(url, null, null);
            chan.cancel(Components.results.NS_BINDING_ABORTED);
            return chan.name;
        },
        load: function load(name, target) {
            let url = name;
            if (url.indexOf(":") === -1)
                url = "resource://dactyl" + this.suffix + "/" + url;

            let stale = this.stale[url];
            dump("JSMLoader: load " + name + " " + stale + "\n");
            dump("JSMLoader: load " + name + " " + this.getTarget(url) + "\n");
            if (stale) {
                delete this.stale[url];

                let global = this.globals[url];
                for each (let prop in Object.getOwnPropertyNames(global))
                    try {
                        if (!(prop in this.builtin) && ["JSMLoader", "set"].indexOf(prop) < 0 &&
                            !global.__lookupGetter__(prop))
                            global[prop] = undefined;
                    }
                    catch (e) {
                        dump("Deleting property " + prop + " on " + url + ":\n    " + e + "\n");
                        Components.utils.reportError(e);
                    }

                if (stale === this.getTarget(url))
                    Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
                              .getService(Components.interfaces.mozIJSSubScriptLoader)
                              .loadSubScript(url, global.global || global);
                dump("JSMLoader: load " + name + " " + global.EXPORTED_SYMBOLS + "\n");
            }
            let global = Components.utils.import(url, target);

            if (name == "base.jsm") {
                global.JSMLoader = this;
                Components.utils.import(url, this.global);
                this.global.EXPORTED_SYMBOLS = global.EXPORTED_SYMBOLS;
            }

            return this.globals[url] = global;
        },
        cleanup: function unregister() {
            for each (let factory in this.factories.splice(0))
                this.manager.unregisterFactory(factory.classID, factory);
        },
        purge: function purge() {
            for (let [url, global] in Iterator(this.globals))
                this.stale[url] = this.getTarget(url);
        },
        registerFactory: function registerFactory(factory) {
            this.manager.registerFactory(factory.classID,
                                         String(factory.classID),
                                         factory.contractID,
                                         factory);
            this.factories.push(factory);
        }
    };

Components.classes["@mozilla.org/fuel/application;1"]
          .getService(Components.interfaces.fuelIApplication)
          .storage.set("dactyl.JSMLoader", JSMLoader);

JSMLoader.load("base.jsm", this);
dump("exports: " + this.JSMLoader+" " +this.EXPORTED_SYMBOLS + "\n");

}catch(e){dump(e+"\n"+e.stack);Components.utils.reportError(e)}
