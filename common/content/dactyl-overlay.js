// Copyright (c) 2008-2010 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

(function () {
    const modules = {};
    const BASE = "chrome://dactyl/content/";

    modules.modules = modules;

    const loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
                             .getService(Components.interfaces.mozIJSSubScriptLoader);

    modules.load = function load(script) {
        for (let [i, base] in Iterator(prefix)) {
            try {
                loader.loadSubScript(base + script + ".js", modules);
                return;
            }
            catch (e) {
                if (e !== "Error opening input stream (invalid filename?)") {
                    dump("dactyl: Trying: " + (base + script + ".js") + ": " + e + "\n" + e.stack);
                    Components.utils.reportError(e);
                }
            }
        }
        try {
            Components.utils.import("resource://dactyl/" + script + ".jsm", modules);
        }
        catch (e) {
            dump("dactyl: Loading script " + script + ": " + e.result + " " + e + "\n");
            dump(Error().stack + "\n");
            Components.utils.reportError(e);
        }
    };

    let prefix = [BASE];

    ["base",
     "modules",
     "storage",
     "util",
     "autocommands",
     "buffer",
     "commandline",
     "commands",
     "completion",
     "configbase",
     "config",
     "dactyl",
     "editor",
     "events",
     "finder",
     "highlight",
     "hints",
     "io",
     "javascript",
     "mappings",
     "marks",
     "modes",
     "options",
     "services",
     "statusline",
     "styles",
     "template",
     ].forEach(modules.load);

    prefix.unshift("chrome://" + modules.services.get("dactyl:").name + "/content/");
    modules.Config.prototype.scripts.forEach(modules.load);
})();

// vim: set fdm=marker sw=4 ts=4 et:
