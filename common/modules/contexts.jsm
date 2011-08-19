// Copyright (c) 2010-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("contexts", {
    exports: ["Contexts", "Group", "contexts"],
    use: ["commands", "messages", "options", "services", "storage", "styles", "template", "util"]
}, this);

var Const = function Const(val) Class.Property({ enumerable: true, value: val });

var Group = Class("Group", {
    init: function init(name, description, filter, persist) {
        const self = this;

        this.name = name;
        this.description = description;
        this.filter = filter || this.constructor.defaultFilter;
        this.persist = persist || false;
        this.hives = [];
    },

    set lastDocument(val) { this._lastDocument = val && Cu.getWeakReference(val); },
    get lastDocument() this._lastDocument && this._lastDocument.get(),

    modifiable: true,

    cleanup: function cleanup() {
        for (let hive in values(this.hives))
            util.trapErrors("cleanup", hive);

        this.hives = [];
        for (let hive in keys(this.hiveMap))
            delete this[hive];
    },
    destroy: function destroy() {
        for (let hive in values(this.hives))
            util.trapErrors("destroy", hive);
    },

    argsExtra: function argsExtra() ({}),

    makeArgs: function makeArgs(doc, context, args) {
        let res = update({ doc: doc, context: context }, args);
        return update(res, this.argsExtra(res), args);
    },

    get toStringParams() [this.name],

    get builtin() this.modules.contexts.builtinGroups.indexOf(this) >= 0,

}, {
    compileFilter: function (patterns, default_) {
        if (arguments.length < 2)
            default_ = false;

        function siteFilter(uri)
            let (match = array.nth(siteFilter.filters, function (f) f(uri), 0))
                match ? match.result : default_;

        return update(siteFilter, {
            toString: function () this.filters.join(","),

            toXML: function (modules) let (uri = modules && modules.buffer.uri)
                template.map(this.filters,
                             function (f) <span highlight={uri && f(uri) ? "Filter" : ""}>{f}</span>,
                             <>,</>),

            filters: Option.parse.sitelist(patterns)
        });
    },

    defaultFilter: Class.memoize(function () this.compileFilter(["*"]))
});

var Contexts = Module("contexts", {
    Local: function Local(dactyl, modules, window) ({
        init: function () {
            const contexts = this;
            this.modules = modules;

            Object.defineProperty(modules.plugins, "contexts", Const({}));

            this.groupList = [];
            this.groupMap = {};
            this.groupsProto = {};
            this.hives = {};
            this.hiveProto = {};

            this.builtin = this.addGroup("builtin", "Builtin items");
            this.user = this.addGroup("user", "User-defined items", null, true);
            this.builtinGroups = [this.builtin, this.user];
            this.builtin.modifiable = false;

            this.GroupFlag = Class("GroupFlag", CommandOption, {
                init: function (name) {
                    this.name = name;

                    this.type = ArgType("group", function (group) {
                        return isString(group) ? contexts.getGroup(group, name)
                                               : group[name];
                    });
                },

                get toStringParams() [this.name],

                names: ["-group", "-g"],

                description: "Group to which to add",

                get default() (contexts.context && contexts.context.group || contexts.user)[this.name],

                completer: function (context) modules.completion.group(context)
            });

            memoize(modules, "userContext",  function () contexts.Context(modules.io.getRCFile("~", true), contexts.user, [modules, true]));
            memoize(modules, "_userContext", function () contexts.Context(modules.io.getRCFile("~", true), contexts.user, [modules.userContext]));
        },

        cleanup: function () {
            for (let hive in values(this.groupList))
                util.trapErrors("cleanup", hive);
        },

        destroy: function () {
            for (let hive in values(this.groupList))
                util.trapErrors("destroy", hive);

            for (let [name, plugin] in iter(this.modules.plugins.contexts))
                if (plugin && "onUnload" in plugin && callable(plugin.onUnload))
                    util.trapErrors("onUnload", plugin);
        },

        signals: {
            "browser.locationChange": function (webProgress, request, uri) {
                this.flush();
            }
        },

        Group: Class("Group", Group, { modules: modules, get hiveMap() modules.contexts.hives }),

        Hives: Class("Hives", Class.Property, {
            init: function init(name, constructor) {
                const { contexts } = modules;
                const self = this;

                if (this.Hive)
                    return {
                        enumerable: true,

                        get: function () array(contexts.groups[self.name])
                    };

                this.Hive = constructor;
                this.name = name;
                memoize(contexts.Group.prototype, name, function () {
                    let group = constructor(this);
                    this.hives.push(group);
                    contexts.flush();
                    return group;
                });

                memoize(contexts.hives, name,
                        function () Object.create(Object.create(contexts.hiveProto,
                                                                { _hive: { value: name } })));

                memoize(contexts.groupsProto, name,
                        function () [group[name] for (group in values(this.groups)) if (Set.has(group, name))]);
            },

            get toStringParams() [this.name, this.Hive]
        })
    }),

    Context: function Context(file, group, args) {
        const { contexts, io, newContext, plugins, userContext } = this.modules;

        let isPlugin = array.nth(io.getRuntimeDirectories("plugins"),
                                 function (dir) dir.contains(file, true),
                                 0);
        let isRuntime = array.nth(io.getRuntimeDirectories(""),
                                  function (dir) dir.contains(file, true),
                                  0);

        let name = isPlugin ? file.getRelativeDescriptor(isPlugin).replace(File.PATH_SEP, "-")
                            : file.leafName;
        let id   = name.replace(/\.[^.]*$/, "").replace(/-([a-z])/g, function (m, n1) n1.toUpperCase());

        let contextPath = file.path;
        let self = Set.has(plugins, contextPath) && plugins.contexts[contextPath];

        if (!self && isPlugin && false)
            self = Set.has(plugins, id) && plugins[id];

        if (self) {
            if (Set.has(self, "onUnload"))
                self.onUnload();
        }
        else {
            self = args && !isArray(args) ? args : newContext.apply(null, args || [userContext]);
            update(self, {
                NAME: Const(id),

                PATH: Const(file.path),

                CONTEXT: Const(self),

                unload: Const(function unload() {
                    if (plugins[this.NAME] === this || plugins[this.PATH] === this)
                        if (this.onUnload)
                            this.onUnload();

                    if (plugins[this.NAME] === this)
                        delete plugins[this.NAME];

                    if (plugins[this.PATH] === this)
                        delete plugins[this.PATH];

                    if (plugins.contexts[contextPath] === this)
                        delete plugins.contexts[contextPath];

                    if (!this.GROUP.builtin)
                        contexts.removeGroup(this.GROUP);
                })
            });

            if (group !== this.user)
                Class.replaceProperty(plugins, file.path, self);

            // This belongs elsewhere
            if (isPlugin)
                Object.defineProperty(plugins, self.NAME, {
                    configurable: true,
                    enumerable: true,
                    get: function () self,
                    set: function (val) {
                        util.dactyl(val).reportError(FailedAssertion(_("plugin.notReplacingContext", self.NAME), 3, false), true);
                    }
                });
        }

        let path = isRuntime ? file.getRelativeDescriptor(isRuntime) : file.path;
        let name = isRuntime ? path.replace(/^(plugin|color)s([\\\/])/, "$1$2") : "script-" + path;

        if (!group)
            group = this.addGroup(commands.nameRegexp
                                          .iterate(name.replace(/\.[^.]*$/, ""))
                                          .join("-").replace(/--+/g, "-"),
                                  _("context.scriptGroup", file.path),
                                  null, false);

        Class.replaceProperty(self, "GROUP", group);
        Class.replaceProperty(self, "group", group);

        return plugins.contexts[contextPath] = self;
    },

    Script: function Script(file, group) {
        return this.Context(file, group, [this.modules.userContext, true]);
    },

    context: null,

    /**
     * Returns a frame object describing the currently executing
     * command, if applicable, otherwise returns the passed frame.
     *
     * @param {nsIStackFrame} frame
     */
    getCaller: function getCaller(frame) {
        if (this.context && this.context.file)
           return {
                __proto__: frame,
                filename: this.context.file[0] == "[" ? this.context.file
                                                      : services.io.newFileURI(File(this.context.file)).spec,
                lineNumber: this.context.line
            };
        return frame;
    },

    groups: Class.memoize(function () this.matchingGroups()),

    allGroups: Class.memoize(function () Object.create(this.groupsProto, {
        groups: { value: this.initializedGroups() }
    })),

    matchingGroups: function (uri) Object.create(this.groupsProto, {
        groups: { value: this.activeGroups(uri) }
    }),

    activeGroups: function (uri) {
        if (uri instanceof Ci.nsIDOMDocument)
            var [doc, uri] = [uri, uri.documentURIObject || util.newURI(uri.documentURI)];

        if (!uri)
            var { uri, doc } = this.modules.buffer;

        return this.initializedGroups().filter(function (g) {
            let res = uri && g.filter(uri, doc);
            if (doc)
                g.lastDocument = res && doc;
            return res;
        });
    },

    flush: function flush() {
        delete this.groups;
        delete this.allGroups;
    },

    initializedGroups: function (hive)
        let (need = hive ? [hive] : Object.keys(this.hives))
            this.groupList.filter(function (group) need.some(Set.has(group))),

    addGroup: function addGroup(name, description, filter, persist, replace) {
        let group = this.getGroup(name);
        if (group)
            name = group.name;

        if (!group) {
            group = this.Group(name, description, filter, persist);
            this.groupList.unshift(group);
            this.groupMap[name] = group;
            this.hiveProto.__defineGetter__(name, function () group[this._hive]);
        }

        if (replace) {
            util.trapErrors("cleanup", group);
            if (description)
                group.description = description;
            if (filter)
                group.filter = filter;
            group.persist = persist;
        }

        this.flush();
        return group;
    },

    removeGroup: function removeGroup(name, filter) {
        if (isObject(name)) {
            if (this.groupList.indexOf(name) === -1)
                return;
            name = name.name;
        }

        let group = this.getGroup(name);

        util.assert(!group || !group.builtin, _("group.cantRemoveBuiltin"));

        if (group) {
            name = group.name;
            this.groupList.splice(this.groupList.indexOf(group), 1);
            util.trapErrors("destroy", group);
        }

        if (this.context && this.context.group === group)
            this.context.group = null;

        delete this.groupMap[name];
        delete this.hiveProto[name];
        this.flush();
        return group;
    },

    getGroup: function getGroup(name, hive) {
        if (name === "default")
            var group = this.context && this.context.context && this.context.context.GROUP;
        else if (Set.has(this.groupMap, name))
            group = this.groupMap[name];

        if (group && hive)
            return group[hive];
        return group;
    },

    getDocs: function getDocs(context) {
        try {
            if (isinstance(context, ["Sandbox"])) {
                let info = "INFO" in context && Cu.evalInSandbox("this.INFO instanceof XML && INFO.toXMLString()", context);
                return info && XML(info);
            }
            if (typeof context.INFO == "xml")
                return context.INFO;
        }
        catch (e) {}
        return null;
    },

    bindMacro: function (args, default_, params) {
        const { dactyl, events, modules } = this.modules;

        function Proxy(obj, key) Class.Property({
            configurable: true,
            enumerable: true,
            get: function Proxy_get() process(obj[key]),
            set: function Proxy_set(val) obj[key] = val
        })

        let process = util.identity;

        if (callable(params))
            var makeParams = function makeParams(self, args)
                let (obj = params.apply(self, args))
                    iter.toObject([k, Proxy(obj, k)] for (k in properties(obj)));
        else if (params)
            makeParams = function makeParams(self, args)
                iter.toObject([name, process(args[i])]
                              for ([i, name] in Iterator(params)));

        let rhs = args.literalArg;
        let type = ["-builtin", "-ex", "-javascript", "-keys"].reduce(function (a, b) args[b] ? b : a, default_);

        switch (type) {
        case "-builtin":
            let noremap = true;
            /* fallthrough */
        case "-keys":
            let silent = args["-silent"];
            rhs = events.canonicalKeys(rhs, true);
            var action = function action() {
                events.feedkeys(action.macro(makeParams(this, arguments)),
                                noremap, silent);
            };
            action.macro = util.compileMacro(rhs, true);
            break;

        case "-ex":
            action = function action() modules.commands
                                              .execute(action.macro, makeParams(this, arguments),
                                                       false, null, action.context);
            action.macro = util.compileMacro(rhs, true);
            action.context = this.context && update({}, this.context);
            break;

        case "-javascript":
            if (callable(params))
                action = dactyl.userEval("(function action() { with (action.makeParams(this, arguments)) {" + args.literalArg + "} })");
            else
                action = dactyl.userFunc.apply(dactyl, params.concat(args.literalArg).array);
            process = function (param) isObject(param) && param.valueOf ? param.valueOf() : param;
            action.params = params;
            action.makeParams = makeParams;
            break;
        }

        action.toString = function toString() (type === default_ ? "" : type + " ") + rhs;
        args = null;
        return action;
    },

    withContext: function withContext(defaults, callback, self)
        this.withSavedValues(["context"], function () {
            this.context = defaults && update({}, defaults);
            return callback.call(self, this.context);
        })
}, {
    Hive: Class("Hive", {
        init: function init(group) {
            this.group = group;
        },

        cleanup: function cleanup() {},
        destroy: function destroy() {},

        get modifiable() this.group.modifiable,

        get argsExtra() this.group.argsExtra,
        get makeArgs() this.group.makeArgs,
        get builtin() this.group.builtin,

        get name() this.group.name,
        set name(val) this.group.name = val,

        get description() this.group.description,
        set description(val) this.group.description = val,

        get filter() this.group.filter,
        set filter(val) this.group.filter = val,

        get persist() this.group.persist,
        set persist(val) this.group.persist = val,

        prefix: Class.memoize(function () this.name === "builtin" ? "" : this.name + ":"),

        get toStringParams() [this.name]
    })
}, {
    commands: function initCommands(dactyl, modules, window) {
        const { commands, contexts } = modules;

        commands.add(["gr[oup]"],
            "Create or select a group",
            function (args) {
                if (args.length > 0) {
                    var name = Option.dequote(args[0]);
                    util.assert(name !== "builtin", _("group.cantModifyBuiltin"));
                    util.assert(commands.validName.test(name), _("group.invalidName", name));

                    var group = contexts.getGroup(name);
                }
                else if (args.bang)
                    var group = args.context && args.context.group;
                else
                    return void modules.completion.listCompleter("group", "", null, null);

                util.assert(group || name, _("group.noCurrent"));

                let filter = Group.compileFilter(args["-locations"]);
                if (!group || args.bang)
                    group = contexts.addGroup(name, args["-description"], filter, !args["-nopersist"], args.bang);
                else if (!group.builtin) {
                    if (args.has("-locations"))
                        group.filter = filter;
                    if (args.has("-description"))
                        group.description = args["-description"];
                    if (args.has("-nopersist"))
                        group.persist = !args["-nopersist"];
                }

                if (!group.builtin && args.has("-args")) {
                    group.argsExtra = contexts.bindMacro({ literalArg: "return " + args["-args"] },
                                                         "-javascript", util.identity);
                    group.args = args["-args"];
                }

                if (args.context) {
                    args.context.group = group;
                    if (args.context.context)
                        args.context.context.group = group;
                }

                util.assert(!group.builtin ||
                                !["-description", "-locations", "-nopersist"]
                                    .some(Set.has(args.explicitOpts)),
                            _("group.cantModifyBuiltin"));
            },
            {
                argCount: "?",
                bang: true,
                completer: function (context, args) {
                    if (args.length == 1)
                        modules.completion.group(context);
                },
                keepQuotes: true,
                options: [
                    {
                        names: ["-args", "-a"],
                        description: "JavaScript Object which augments the arguments passed to commands, mappings, and autocommands",
                        type: CommandOption.STRING
                    },
                    {
                        names: ["-description", "-desc", "-d"],
                        description: "A description of this group",
                        default: ["User-defined group"],
                        type: CommandOption.STRING
                    },
                    {
                        names: ["-locations", "-locs", "-loc", "-l"],
                        description: ["The URLs for which this group should be active"],
                        default: ["*"],
                        type: CommandOption.LIST
                    },
                    {
                        names: ["-nopersist", "-n"],
                        description: "Do not save this group to an auto-generated RC file"
                    }
                ],
                serialGroup: 20,
                serialize: function () [
                    {
                        command: this.name,
                        bang: true,
                        options: iter([v, typeof group[k] == "boolean" ? null : group[k]]
                                      // FIXME: this map is expressed multiple times
                                      for ([k, v] in Iterator({
                                          args: "-args",
                                          description: "-description",
                                          filter: "-locations"
                                      }))
                                      if (group[k])).toObject(),
                        arguments: [group.name],
                        ignoreDefaults: true
                    }
                    for (group in values(contexts.initializedGroups()))
                    if (!group.builtin && group.persist)
                ].concat([{ command: this.name, arguments: ["user"] }])
            });

        commands.add(["delg[roup]"],
            "Delete a group",
            function (args) {
                util.assert(args.bang ^ !!args[0], _("error.argumentOrBang"));

                if (args.bang)
                    contexts.groupList = contexts.groupList.filter(function (g) g.builtin);
                else {
                    util.assert(contexts.getGroup(args[0]), _("group.noSuch", args[0]));
                    contexts.removeGroup(args[0]);
                }
            },
            {
                argCount: "?",
                bang: true,
                completer: function (context, args) {
                    if (args.bang)
                        return;
                    context.filters.push(function ({ item }) !item.builtin);
                    modules.completion.group(context);
                }
            });

        commands.add(["fini[sh]"],
            "Stop sourcing a script file",
            function (args) {
                util.assert(args.context, _("command.finish.illegal"));
                args.context.finished = true;
            },
            { argCount: "0" });

        function checkStack(cmd) {
            util.assert(contexts.context && contexts.context.stack &&
                        contexts.context.stack[cmd] && contexts.context.stack[cmd].length,
                        _("command.conditional.illegal"));
        }
        function pop(cmd) {
            checkStack(cmd);
            return contexts.context.stack[cmd].pop();
        }
        function push(cmd, value) {
            util.assert(contexts.context, _("command.conditional.illegal"));
            if (arguments.length < 2)
                value = contexts.context.noExecute;
            contexts.context.stack = contexts.context.stack || {};
            contexts.context.stack[cmd] = (contexts.context.stack[cmd] || []).concat([value]);
        }

        commands.add(["if"],
            "Execute commands until the next :elseif, :else, or :endif only if the argument returns true",
            function (args) { args.context.noExecute = !dactyl.userEval(args[0]); },
            {
                always: function (args) { push("if"); },
                argCount: "1",
                literal: 0
            });
        commands.add(["elsei[f]", "elif"],
            "Execute commands until the next :elseif, :else, or :endif only if the argument returns true",
            function (args) {},
            {
                always: function (args) {
                    checkStack("if");
                    args.context.noExecute = args.context.stack.if.slice(-1)[0] ||
                        !args.context.noExecute || !dactyl.userEval(args[0]);
                },
                argCount: "1",
                literal: 0
            });
        commands.add(["el[se]"],
            "Execute commands until the next :endif only if the previous conditionals were not executed",
            function (args) {},
            {
                always: function (args) {
                    checkStack("if");
                    args.context.noExecute = args.context.stack.if.slice(-1)[0] ||
                        !args.context.noExecute;
                },
                argCount: "0"
            });
        commands.add(["en[dif]", "fi"],
            "End a string of :if/:elseif/:else conditionals",
            function (args) {},
            {
                always: function (args) { args.context.noExecute = pop("if"); },
                argCount: "0"
            });
    },
    completion: function initCompletion(dactyl, modules, window) {
        const { completion, contexts } = modules;

        completion.group = function group(context, active) {
            context.title = ["Group"];
            let uri = modules.buffer.uri;
            context.keys = {
                active: function (group) group.filter(uri),
                text: "name",
                description: function (g) <>{g.filter.toXML ? g.filter.toXML(modules) + <>&#xa0;</> : ""}{g.description || ""}</>
            };
            context.completions = (active === undefined ? contexts.groupList : contexts.initializedGroups(active))
                                    .slice(0, -1);

            iter({ Active: true, Inactive: false }).forEach(function ([name, active]) {
                context.split(name, null, function (context) {
                    context.title[0] = name + " Groups";
                    context.filters.push(function ({ item }) !!item.filter(modules.buffer.uri) == active);
                });
            });
        };
    }
});

endModule();

} catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
