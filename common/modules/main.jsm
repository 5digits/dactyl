// Copyright (c) 2009-2012 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

defineModule("main", {
    exports: ["ModuleBase"],
    require: ["config", "overlay", "services", "util"]
});

var BASE = "resource://dactyl-content/";

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

var _id = 0;

var Modules = function Modules(window) {
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
     *     for the new module. Each function is called as soon as the
     *     named module has been initialized. The constructors are
     *     guaranteed to be called in the same order that the dependent
     *     modules were initialized.
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
        prototype._metaInit_ = function () {
            delete module.prototype._metaInit_;
            Class.replaceProperty(modules, module.className, this);
        };
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

    const create = window.Object.create.bind(window.Object);


    const BASES = [BASE, "resource://dactyl-local-content/"];

    jsmodules = Cu.createObjectIn(window);
    jsmodules.NAME = "jsmodules";
    const modules = update(create(jsmodules), {
        yes_i_know_i_should_not_report_errors_in_these_branches_thanks: [],

        jsmodules: jsmodules,

        get content() this.config.browser.contentWindow || window.content,

        window: window,

        Module: Module,

        load: function load(script) {
            for (let [i, base] in Iterator(BASES)) {
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
                require(script, jsmodules);
            }
            catch (e) {
                util.dump("Loading script " + script + ":");
                util.reportError(e);
            }
        },

        newContext: function newContext(proto, normal, name) {
            if (normal)
                return create(proto);

            if (services.has("dactyl") && services.dactyl.createGlobal)
                var sandbox = services.dactyl.createGlobal();
            else
                sandbox = Components.utils.Sandbox(window, { sandboxPrototype: proto || modules,
                                                             sandboxName: name || ("Dactyl Sandbox " + ++_id),
                                                             wantXrays: false });

            // Hack:
            // sandbox.Object = jsmodules.Object;
            sandbox.File = jsmodules.File;
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
    return modules;
}

config.loadStyles();

overlay.overlayWindow(Object.keys(config.overlays), function _overlay(window) ({
    ready: function onInit(document) {
        const modules = Modules(window);
        modules.moduleManager = this;
        this.modules = modules;

        window.dactyl = { modules: modules };

        defineModule.time("load", null, function _load() {
            config.modules.global
                  .forEach(function (name) defineModule.time("load", name, require, null, name, modules.jsmodules));

            config.modules.window
                  .forEach(function (name) defineModule.time("load", name, modules.load, modules, name));
        }, this);
    },

    load: function onLoad(document) {
        let self = this;

        var { modules, Module } = this.modules;
        delete window.dactyl;

        this.startTime = Date.now();
        this.deferredInit = { load: {} };
        this.seen = {};
        this.loaded = {};
        modules.loaded = this.loaded;

        this.modules = modules;

        this.scanModules();
        this.initDependencies("init");

        modules.config.scripts.forEach(modules.load);

        this.scanModules();

        defineModule.modules.forEach(function defModule({ lazyInit, constructor: { className } }) {
            if (!lazyInit) {
                Class.replaceProperty(modules, className, modules[className]);
                this.initDependencies(className);
            }
            else
                modules.__defineGetter__(className, function () {
                    let module = modules.jsmodules[className];
                    Class.replaceProperty(modules, className, module);
                    if (module.reallyInit)
                        module.reallyInit(); // :(

                    if (!module.lazyDepends)
                        self.initDependencies(className);
                    return module;
                });
        }, this);
    },

    cleanup: function cleanup(window) {
        overlay.windows = overlay.windows.filter(function (w) w != window);
    },

    unload: function unload(window) {
        for each (let mod in this.modules.moduleList.reverse()) {
            mod.stale = true;

            if ("destroy" in mod)
                util.trapErrors("destroy", mod);
        }
    },

    visible: function visible(window) {
        // Module.list.forEach(load);
        this.initDependencies("load");
        this.modules.times = update({}, defineModule.times);

        defineModule.loadLog.push("Loaded in " + (Date.now() - this.startTime) + "ms");

        overlay.windows = array.uniq(overlay.windows.concat(window), true);
    },

    loadModule: function loadModule(module, prereq, frame) {
        let { loaded, seen } = this;
        let { Module, modules } = this.modules;

        if (isString(module)) {
            if (!Module.constructors.hasOwnProperty(module))
                modules.load(module);
            module = Module.constructors[module];
        }

        try {
            if (Set.has(loaded, module.className))
                return;

            if (Set.add(seen, module.className))
                throw Error("Module dependency loop.");

            for (let dep in values(module.requires))
                this.loadModule(Module.constructors[dep], module.className);

            defineModule.loadLog.push(
                "Load" + (isString(prereq) ? " " + prereq + " dependency: " : ": ")
                    + module.className);

            if (frame && frame.filename)
                defineModule.loadLog.push("  from: " + util.fixURI(frame.filename) + ":" + frame.lineNumber);

            let obj = defineModule.time(module.className, "init", module);
            Class.replaceProperty(modules, module.className, obj);

            Set.add(loaded, module.className);

            if (loaded.dactyl && obj.signals)
                modules.dactyl.registerObservers(obj);

            if (!module.lazyDepends)
                this.initDependencies(module.className);
        }
        catch (e) {
            util.dump("Loading " + (module && module.className) + ":");
            util.reportError(e);
        }
        return modules[module.className];
    },

    deferInit: function deferInit(name, INIT, mod) {
        let { modules } = this.modules;

        let init = this.deferredInit[name] || {};
        this.deferredInit[name] = init;

        let className = mod.className || mod.constructor.className;

        if (!Set.has(init, className)) {
            init[className] = function callee() {
                function finish() {
                    this.currentDependency = className;
                    defineModule.time(className, name, INIT[name], mod,
                                      modules.dactyl, modules, window);
                }
                if (!callee.frobbed) {
                    callee.frobbed = true;
                    if (modules[name] instanceof Class)
                        modules[name].withSavedValues(["currentDependency"], finish);
                    else
                        finish.call({});
                }
            };

            INIT[name].require = function (name) { init[name](); };
        }
    },

    scanModules: function scanModules() {
        let self = this;
        let { Module, modules } = this.modules;

        defineModule.modules.forEach(function defModule(mod) {
            let names = Set(Object.keys(mod.INIT));
            if ("init" in mod.INIT)
                Set.add(names, "init");

            keys(names).forEach(function (name) { self.deferInit(name, mod.INIT, mod); });
        });

        Module.list.forEach(function frobModule(mod) {
            if (!mod.frobbed) {
                modules.__defineGetter__(mod.className, function () {
                    delete modules[mod.className];
                    return self.loadModule(mod.className, null, Components.stack.caller);
                });
                Object.keys(mod.prototype.INIT)
                      .forEach(function (name) { self.deferInit(name, mod.prototype.INIT, mod); });
            }
            mod.frobbed = true;
        });
    },

    initDependencies: function initDependencies(name, parents) {
        for (let [k, v] in Iterator(this.deferredInit[name] || {}))
            if (!parents || ~parents.indexOf(k))
                util.trapErrors(v);
    }
}));

endModule();

} catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
