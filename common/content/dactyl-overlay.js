// Copyright (c) 2008-2010 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

(function () {
    function newContext(proto) {
        let sandbox = Components.utils.Sandbox(window, { sandboxPrototype: proto || modules, wantXrays: false });
        // Hack:
        sandbox.Object = jsmodules.Object;
        sandbox.Math = jsmodules.Math;
        sandbox.__proto__ = proto || modules;
        return sandbox;
    }
    const jsmodules = {};
    const modules = {
        __proto__: jsmodules,
        get content() window.content,
        jsmodules: jsmodules,
        newContext: newContext,
        window: window
    };
    modules.modules = modules;

    const BASE = "chrome://dactyl/content/";
    const loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
                             .getService(Components.interfaces.mozIJSSubScriptLoader);

    modules.load = function load(script) {
        for (let [i, base] in Iterator(prefix)) {
            try {
                loader.loadSubScript(base + script + ".js", modules, "UTF-8");
                return;
            }
            catch (e) {
                if (typeof e !== "string") {
                    dump("dactyl: Trying: " + (base + script + ".js") + ": " + e + "\n" + e.stack + "\n");
                    Components.utils.reportError(e);
                }
            }
        }
        try {
            Components.utils.import("resource://dactyl/" + script + ".jsm", jsmodules);
        }
        catch (e) {
            dump("dactyl: Loading script " + script + ": " + e.result + " " + e + "\n");
            dump(Error().stack + "\n");
            Components.utils.reportError(e);
        }
    };

    let prefix = [BASE];

    modules.load("services");
    prefix.unshift("chrome://" + modules.services["dactyl:"].name + "/content/");

    ["base",
     "modules",
     "prefs",
     "storage",
     "util",
     "javascript",
     "dactyl",
     "modes",
     "abbreviations",
     "autocommands",
     "buffer",
     "commandline",
     "commands",
     "completion",
     "configbase",
     "config",
     "editor",
     "events",
     "finder",
     "highlight",
     "hints",
     "io",
     "mappings",
     "marks",
     "options",
     "statusline",
     "styles",
     "template"
     ].forEach(modules.load);

    modules.Config.prototype.scripts.forEach(modules.load);
})();

// vim: set fdm=marker sw=4 ts=4 et:
