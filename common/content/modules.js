// Copyright (c) 2009 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/**
 * @class ModuleBase
 * The base class for all modules.
 */
const ModuleBase = Class("ModuleBase", {
    /**
     * @property {[string]} A list of module prerequisites which
     * must be initialized before this module is loaded.
     */
    requires: [],

    toString: function () "[module " + this.constructor.name + "]"
});

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
    module.prototype.INIT = module.INIT;
    module.requires = prototype.requires || [];
    Module.list.push(module);
    Module.constructors[name] = module;
    return module;
}
Module.list = [];
Module.constructors = {};

window.addEventListener("load", function onLoad() {
    window.removeEventListener("load", onLoad, false);

    Module.list.forEach(function(module) {
        modules.__defineGetter__(module.name, function() {
            delete modules[module.name];
            return load(module.name, null, Components.stack.caller);
        });
    });

    function dump(str) window.dump(String.replace(str, /\n?$/, "\n").replace(/^/m, Config.prototype.name.toLowerCase() + ": "));
    const start = Date.now();
    const deferredInit = { load: [] };
    const seen = set();
    const loaded = set(["init"]);

    function init(module) {
        function init(func, mod)
            function () defmodule.time(module.name || module.constructor.name, mod, func, module, dactyl, modules, window);

        set.add(loaded, module.constructor.name);
        for (let [mod, func] in Iterator(module.INIT)) {
            if (mod in loaded)
                init(func)();
            else {
                deferredInit[mod] = deferredInit[mod] || [];
                deferredInit[mod].push(init(func, mod));
            }
        }
    }
    defmodule.modules.map(init);

    function load(module, prereq, frame) {
        if (isstring(module)) {
            if (!Module.constructors.hasOwnProperty(module))
                modules.load(module);
            module = Module.constructors[module];
        }

        try {
            if (module.name in loaded)
                return;
            if (module.name in seen)
                throw Error("Module dependency loop.");
            set.add(seen, module.name);

            for (let dep in values(module.requires))
                load(Module.constructors[dep], module.name);

            defmodule.loadLog.push("Load" + (isstring(prereq) ? " " + prereq + " dependency: " : ": ") + module.name);
            if (frame && frame.filename)
                defmodule.loadLog.push(" from: " + frame.filename + ":" + frame.lineNumber);

            delete modules[module.name];
            modules[module.name] = defmodule.time(module.name, "init", module);

            init(modules[module.name]);
            for (let [, fn] in iter(deferredInit[module.name] || []))
                fn();
        }
        catch (e) {
            dump("Loading " + (module && module.name) + ": " + e + "\n" + (e.stack || ""));
        }
        return modules[module.name];
    }

    Module.list.forEach(load);
    deferredInit["load"].forEach(call);

    dump("Loaded in " + (Date.now() - start) + "ms");
}, false);

window.addEventListener("unload", function onUnload() {
    window.removeEventListener("unload", onUnload, false);
    for (let [, mod] in iter(modules))
        if (mod instanceof ModuleBase && "destroy" in mod)
            mod.destroy();
}, false);

// vim: set fdm=marker sw=4 ts=4 et:
