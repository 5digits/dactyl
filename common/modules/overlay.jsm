// Copyright (c) 2009-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("overlay", {
    exports: ["ModuleBase"],
    require: ["config", "io", "services", "util"]
}, this);

/**
 * @class ModuleBase
 * The base class for all modules.
 */
var ModuleBase = Class("ModuleBase", {
    /**
     * @property {[string]} A list of module prerequisites which
     * must be initialized before this module is loaded.
     */
    requires: [],

    toString: function () "[module " + this.constructor.className + "]"
});

var Overlay = Module("Overlay", {
    init: function init() {
        services["dactyl:"]; // Hack. Force module initialization.

        config.loadStyles();

        util.overlayWindow(config.overlayChrome, function overlay(window) ({
            init: function onInit(document) {
                /**
                 * @constructor Module
                 *
                 * Constructs a new ModuleBase class and makes arrangements for its
                 * initialization. Arguments marked as optional must be either
                 * entirely elided, or they must have the exact type specified.
                 * Loading semantics are as follows:
                 *
                 *  - A module is guaranteed not to be initialized before any of its
                 *    prerequisites as listed in its {@see ModuleBase#requires} member.
                 *  - A module is considered initialized once it's been instantiated,
                 *    its {@see Class#init} method has been called, and its
                 *    instance has been installed into the top-level {@see modules}
                 *    object.
                 *  - Once the module has been initialized, its module-dependent
                 *    initialization functions will be called as described hereafter.
                 * @param {string} name The module's name as it will appear in the
                 *     top-level {@see modules} object.
                 * @param {ModuleBase} base The base class for this module.
                 *     @optional
                 * @param {Object} prototype The prototype for instances of this
                 *     object. The object itself is copied and not used as a prototype
                 *     directly.
                 * @param {Object} classProperties The class properties for the new
                 *     module constructor.
                 *     @optional
                 * @param {Object} moduleInit The module initialization functions
                 *     for the new module. Each function is called as soon as the named module
                 *     has been initialized, but after the module itself. The constructors are
                 *     guaranteed to be called in the same order that the dependent modules
                 *     were initialized.
                 *     @optional
                 *
                 * @returns {function} The constructor for the resulting module.
                 */
                function Module(name) {
                    let args = Array.slice(arguments);

                    var base = ModuleBase;
                    if (callable(args[1]))
                        base = args.splice(1, 1)[0];
                    let [, prototype, classProperties, moduleInit] = args;
                    const module = Class(name, base, prototype, classProperties);

                    module.INIT = moduleInit || {};
                    module.modules = modules;
                    module.prototype.INIT = module.INIT;
                    module.requires = prototype.requires || [];
                    Module.list.push(module);
                    Module.constructors[name] = module;
                    return module;
                }
                Module.list = [];
                Module.constructors = {};

                const BASE = "resource://dactyl-content/";

                const create = window.Object.create || (function () {
                    window.__dactyl_eval_string = "(function (proto) ({ __proto__: proto }))";
                    JSMLoader.loadSubScript(BASE + "eval.js", window);

                    let res = window.__dactyl_eval_result;
                    delete window.__dactyl_eval_string;
                    delete window.__dactyl_eval_result;
                    return res;
                })();

                const jsmodules = { NAME: "jsmodules" };
                const modules = update(create(jsmodules), {
                    yes_i_know_i_should_not_report_errors_in_these_branches_thanks: [],

                    jsmodules: jsmodules,

                    get content() this.config.browser.contentWindow || window.content,

                    window: window,

                    Module: Module,

                    load: function load(script) {
                        for (let [i, base] in Iterator(prefix)) {
                            try {
                                JSMLoader.loadSubScript(base + script + ".js", modules, "UTF-8");
                                return;
                            }
                            catch (e) {
                                if (typeof e !== "string") {
                                    util.dump("Trying: " + (base + script + ".js") + ":");
                                    util.reportError(e);
                                }
                            }
                        }
                        try {
                            require(jsmodules, script);
                        }
                        catch (e) {
                            util.dump("Loading script " + script + ":");
                            util.reportError(e);
                        }
                    },

                    newContext: function newContext(proto, normal) {
                        if (normal)
                            return create(proto);
                        let sandbox = Components.utils.Sandbox(window, { sandboxPrototype: proto || modules, wantXrays: false });
                        // Hack:
                        sandbox.Object = jsmodules.Object;
                        sandbox.Math = jsmodules.Math;
                        sandbox.__proto__ = proto || modules;
                        return sandbox;
                    },

                    get ownPropertyValues() array.compact(
                            Object.getOwnPropertyNames(this)
                                  .map(function (name) Object.getOwnPropertyDescriptor(this, name).value, this)),

                    get moduleList() this.ownPropertyValues.filter(function (mod) mod instanceof this.ModuleBase || mod.isLocalModule, this)
                });
                modules.plugins = create(modules);
                modules.modules = modules;
                window.dactyl = { modules: modules };

                let prefix = [BASE, "resource://dactyl-local-content/"];

                defineModule.time("load", null, function _load() {
                    ["addons",
                     "base",
                     "io",
                     "commands",
                     "completion",
                     "config",
                     "contexts",
                     "downloads",
                     "finder",
                     "highlight",
                     "javascript",
                     "messages",
                     "options",
                     "overlay",
                     "prefs",
                     "sanitizer",
                     "services",
                     "storage",
                     "styles",
                     "template",
                     "util"
                    ].forEach(function (name) defineModule.time("load", name, require, null, jsmodules, name));

                    ["dactyl",
                     "modes",
                     "commandline",
                     "abbreviations",
                     "autocommands",
                     "buffer",
                     "editor",
                     "events",
                     "hints",
                     "mappings",
                     "marks",
                     "mow",
                     "statusline"
                     ].forEach(function (name) defineModule.time("load", name, modules.load, modules, name));
                }, this);
            },
            load: function onLoad(document) {
                // This is getting to be horrible. --Kris

                var { modules, Module } = window.dactyl.modules;
                delete window.dactyl;

                const start = Date.now();
                const deferredInit = { load: {} };
                const seen = Set();
                const loaded = Set();
                modules.loaded = loaded;

                function load(module, prereq, frame) {
                    if (isString(module)) {
                        if (!Module.constructors.hasOwnProperty(module))
                            modules.load(module);
                        module = Module.constructors[module];
                    }

                    try {
                        if (module.className in loaded)
                            return;
                        if (module.className in seen)
                            throw Error("Module dependency loop.");
                        Set.add(seen, module.className);

                        for (let dep in values(module.requires))
                            load(Module.constructors[dep], module.className);

                        defineModule.loadLog.push("Load" + (isString(prereq) ? " " + prereq + " dependency: " : ": ") + module.className);
                        if (frame && frame.filename)
                            defineModule.loadLog.push(" from: " + util.fixURI(frame.filename) + ":" + frame.lineNumber);

                        let obj = defineModule.time(module.className, "init", module);
                        Class.replaceProperty(modules, module.className, obj);
                        loaded[module.className] = true;

                        if (loaded.dactyl && obj.signals)
                            modules.dactyl.registerObservers(obj);

                        frob(module.className);
                    }
                    catch (e) {
                        util.dump("Loading " + (module && module.className) + ":");
                        util.reportError(e);
                    }
                    return modules[module.className];
                }

                function deferInit(name, INIT, mod) {
                    let init = deferredInit[name] = deferredInit[name] || {};
                    let className = mod.className || mod.constructor.className;

                    init[className] = function callee() {
                        if (!callee.frobbed)
                            defineModule.time(className, name, INIT[name], mod,
                                              modules.dactyl, modules, window);
                        callee.frobbed = true;
                    };

                    INIT[name].require = function (name) { init[name](); };
                }

                function frobModules() {
                    Module.list.forEach(function frobModule(mod) {
                        if (!mod.frobbed) {
                            modules.__defineGetter__(mod.className, function () {
                                delete modules[mod.className];
                                return load(mod.className, null, Components.stack.caller);
                            });
                            Object.keys(mod.prototype.INIT)
                                  .forEach(function (name) { deferInit(name, mod.prototype.INIT, mod); });
                        }
                        mod.frobbed = true;
                    });
                }
                defineModule.modules.forEach(function defModule(mod) {
                    let names = Set(Object.keys(mod.INIT));
                    if ("init" in mod.INIT)
                        Set.add(names, "init");

                    keys(names).forEach(function (name) { deferInit(name, mod.INIT, mod); });
                });

                function frob(name) { values(deferredInit[name] || {}).forEach(call); }

                frobModules();
                frob("init");
                modules.config.scripts.forEach(modules.load);
                frobModules();

                defineModule.modules.forEach(function defModule({ lazyInit, constructor: { className } }) {
                    if (!lazyInit) {
                        frob(className);
                        Class.replaceProperty(modules, className, modules[className]);
                    }
                    else
                        modules.__defineGetter__(className, function () {
                            delete modules[className];
                            frob(className);
                            return modules[className] = modules[className];
                        });
                });

                // Module.list.forEach(load);
                frob("load");
                modules.times = update({}, defineModule.times);

                defineModule.loadLog.push("Loaded in " + (Date.now() - start) + "ms");

                modules.events.listen(window, "unload", function onUnload() {
                    window.removeEventListener("unload", onUnload.wrapped, false);

                    for each (let mod in modules.moduleList.reverse()) {
                        mod.stale = true;

                        if ("destroy" in mod)
                            util.trapErrors("destroy", mod);
                    }
                }, false);
            }
        }));
    }
});

endModule();

} catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
