// Copyright (c) 2010-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var Group = Class("Group", {
    init: function init(name, description, filter, persist) {
        const self = this;
        this.name = name;
        this.description = description;
        this.filter = filter || Group.defaultFilter;
        this.persist = persist || false;
        this.hives = [];
    },

    cleanup: function cleanup() {
        for (let hive in values(this.hives))
            dactyl.trapErrors("cleanup", hive);

        this.hives = [];
        for (let hive in keys(Group.hiveMap))
            delete this[hive];
    },
    destroy: function destroy() {
        for (let hive in values(this.hives))
            dactyl.trapErrors("destroy", hive);
    },

    argsExtra: function argsExtra() ({}),

    get toStringParams() [this.name],

    get builtin() contexts.builtinGroups.indexOf(this) >= 0,

}, {
    compileFilter: function (patterns) {

        function siteFilter(uri) siteFilter.filters.every(function (f) f(uri) == f.result);

        if (!isArray(patterns))
            patterns = Option.splitList(patterns, true);

        return update(siteFilter, {
            toString: function () this.filters.join(","),

            toXML: function () template.map(this.filters, function (f) <span highlight={f(buffer.uri) ? "Filter" : ""}>{f}</span>, <>,</>),

            filters: patterns.map(function (pattern) {
                let [, res, filter] = /^(!?)(.*)/.exec(pattern);

                return update(Styles.matchFilter(Option.dequote(filter)), {
                    result: !res,
                    toString: function () pattern
                });
            })
        });
    },

    groupsProto: {},

    defaultFilter: Class.memoize(function () this.compileFilter(["*"])),

    hiveMap: {},

    Hive: Class("Hive", {
        init: function init(group) {
            this.group = group;
        },

        cleanup: function cleanup() {},
        destroy: function destroy() {},

        get argsExtra() this.group.argsExtra,
        get builtin() this.group.builtin,

        get name() this.group.name,
        set name(val) this.group.name = val,

        get description() this.group.description,
        set description(val) this.group.description = val,

        get filter() this.group.filter,
        set filter(val) this.group.filter = val,

        get persist() this.group.persist,
        set persist(val) this.group.persist = val,

        get toStringParams() [this.name]
    }),

    Hives: Class("Hives", Class.Property, {
        init: function init(name, constructor) {
            const self = this;
            if (this.Group)
                return {
                    enumerable: true,

                    get: function () array(contexts.groups[self.name])
                };


            this.Group = constructor;
            this.name = name;
            memoize(Group.prototype, name, function () {
                let group = constructor(this);
                this.hives.push(group);
                delete contexts.groups;
                return group;
            });

            memoize(Group.hiveMap, name,
                    function () Object.create(Object.create(contexts.hiveProto,
                                                            { _hive: { value: name } })));

            memoize(Group.groupsProto, name,
                    function () [group[name] for (group in values(this.groups)) if (set.has(group, name))]);
        }
    })
});

plugins.contexts = {};

var Contexts = Module("contexts", {
    init: function () {
        this.groupList = [];
        this.groupMap = {};
        this.hiveProto = {};

        this.builtin = this.addGroup("builtin", "Builtin items");
        this.user = this.addGroup("user", "User-defined items", null, true);
        this.builtinGroups = [this.builtin, this.user];
    },

    cleanup: function () {
        for (let hive in values(this.groupList))
            dactyl.trapErrors("cleanup", hive);
    },

    destroy: function () {
        for (let hive in values(this.groupList))
            dactyl.trapErrors("destroy", hive);

        for (let plugin in values(plugins.contexts))
            if (plugin.onUnload)
                dactyl.trapErrors("onUnload", plugin);
    },

    context: null,

    groups: Class.memoize(function () Object.create(Group.groupsProto, {
        groups: { value: this.activeGroups().filter(function (g) g.filter(buffer.uri)) }
    })),

    allGroups: Class.memoize(function () Object.create(Group.groupsProto, {
        groups: { value: this.activeGroups() }
    })),

    activeGroups: function (hive)
        let (need = hive ? [hive] : Object.keys(this.hives))
            this.groupList.filter(function (group) need.some(function (name) set.has(group, name))),

    get hives() Group.hiveMap,

    addGroup: function addGroup(name, description, filter, persist, replace) {
        let group = this.getGroup(name);
        if (group)
            name = group.name;

        if (!group) {
            group = Group(name, description, filter, persist);
            this.groupList.unshift(group);
            this.groupMap[name] = group;
            this.hiveProto.__defineGetter__(name, function () group[this._hive]);
        }

        if (replace) {
            dactyl.trapErrors("cleanup", group);
            if (description)
                group.description = description;
            if (filter)
                group.filter = filter
            group.persist = persist;
        }

        delete this.groups;
        return group;
    },

    removeGroup: function removeGroup(name, filter) {
        if (isObject(name)) {
            if (this.groupList.indexOf(name) === -1)
                return;
            name = name.name;
        }

        let group = this.getGroup(name);

        dactyl.assert(!group || !group.builtin, "Cannot remove builtin group");

        if (group) {
            name = group.name;
            this.groupList.splice(this.groupList.indexOf(group), 1);
            dactyl.trapErrors("destroy", group);
        }

        if (this.context && this.context.group === group)
            this.context.group = null;

        delete this.groupMap[name];
        delete this.hiveProto[name];
        delete this.groups;
        return group;
    },

    getGroup: function getGroup(name, hive) {
        if (name === "default")
            var group = this.context && this.context.context && this.context.context.GROUP;
        else
            group = set.has(this.groupMap, name) && this.groupMap[name];

        if (group && hive)
            return group[hive];
        return group;
    },

    bindMacro: function (args, default_, params) {
        let process = util.identity;

        if (callable(params))
            var makeParams = function makeParams(self, args)
                iter.toObject([k, process(v)]
                               for ([k, v] in iter(params.apply(self, args))));
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
            var action = function action() events.feedkeys(action.macro(makeParams(this, arguments)),
                                                           noremap, silent);
            action.macro = util.compileMacro(rhs, true);
            break;
        case "-ex":
            action = function action() commands.execute(action.macro, makeParams(this, arguments),
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
            action.makeParams = makeParams;
            break;
        }
        action.toString = function toString() (type === default_ ? "" : type + " ") + rhs;
        args = null;
        return action;
    },

    GroupFlag: function (name) ({
        names: ["-group", "-g"],

        description: "Group to which to add",

        type: ArgType("group", function (group) isString(group) ? contexts.getGroup(group, name) : group[name]),

        get default() (contexts.context && contexts.context.group || contexts.user)[name],

        completer: function (context) completion.group(context)
    }),

    withContext: function withContext(defaults, callback, self)
        this.withSavedValues(["context"], function () {
            this.context = defaults && update({}, defaults);
            return callback.call(self, this.context);
        })
}, {
    Context: modules.Script = function Context(file, group, args) {
        function Const(val) Class.Property({ enumerable: true, value: val });

        let isPlugin = array.nth(io.getRuntimeDirectories("plugins"),
                                 function (dir) dir.contains(file, true),
                                 0);
        let isRuntime = array.nth(io.getRuntimeDirectories(""),
                                  function (dir) dir.contains(file, true),
                                  0);

        let self = set.has(plugins, file.path) && plugins[file.path];
        if (self) {
            if (set.has(self, "onUnload"))
                self.onUnload();
        }
        else {
            let name = isPlugin ? file.getRelativeDescriptor(isPlugin).replace(File.PATH_SEP, "-") : file.leafName;

            self = update(modules.newContext.apply(null, args || [userContext]), {
                NAME: Const(name.replace(/\..*/, "").replace(/-([a-z])/g, function (m, n1) n1.toUpperCase())),

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

                    if (!this.GROUP.builtin)
                        contexts.removeGroup(this.GROUP);
                })
            });
            Class.replaceProperty(plugins, file.path, self);

            // This belongs elsewhere
            if (isPlugin && args)
                Object.defineProperty(plugins, self.NAME, {
                    configurable: true,
                    enumerable: true,
                    value: self
                });
        }

        let path = isRuntime ? file.getRelativeDescriptor(isRuntime) : file.path;

        if (!group)
            group = contexts.addGroup((isRuntime ? "" : "script-") +
                                          commands.nameRegexp.iterate(path.replace(/\.[^.]*$/, ""))
                                                  .join("-"),
                                      "Script group for " + file.path,
                                      null, false);

        Class.replaceProperty(self, "GROUP", group);
        Class.replaceProperty(self, "group", group);

        return plugins.contexts[file.path] = self;
    },
    Script: function Script(file, group) {
        return this.Context(file, group, [plugins, true]);
    }
}, {
    commands: function initCommands() {

        commands.add(["gr[oup]"],
            "Create or select a group",
            function (args) {
                if (args.length > 0) {
                    var name = Option.dequote(args[0]);
                    dactyl.assert(name !== "builtin", "Cannot modify builtin group");
                    dactyl.assert(commands.validName.test(name), "Invalid group name");

                    var group = contexts.getGroup(name);
                }
                else if (args.bang)
                    var group = args.context && args.context.group;
                else
                    return void completion.listCompleter("group", "", null, null);

                dactyl.assert(group || name, "No current group");

                let filter = Group.compileFilter(args["-locations"]);
                if (!group || args.bang)
                    group = contexts.addGroup(name, args["-description"], filter, !args["-nopersist"], args.bang);
                else if (!group.builtin) {
                    if (args.has("-locations"))
                        group.filter = filter;
                    if (args.has("-description"))
                        group.description = args["-description"]
                    if (args.has("-nopersist"))
                        group.persist = !args["-nopersist"]
                }

                if (!group.builtin && args.has("-args")) {
                    group.argsExtra = contexts.bindMacro({ literalArg: "return " + args["-args"] },
                                                         "-javascript", util.identity);
                    group.args = args["-args"];
                }

                if (args.context)
                    args.context.group = group;
            },
            {
                argCount: "?",
                bang: true,
                completer: function (context, args) {
                    if (args.length == 1)
                        completion.group(context);
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
                    for (group in values(contexts.activeGroups()))
                    if (!group.builtin && group.persist)
                ].concat([{ command: this.name, arguments: ["user"] }])
            });

        commands.add(["delg[roup]"],
            "Delete a group",
            function (args) {
                dactyl.assert(contexts.getGroup(args[0]), "No such group: " + args[0]);
                contexts.removeGroup(args[0]);
            },
            {
                argCount: "1",
                completer: function (context, args) {
                    completion.group(context);
                    context.filters.push(function ({ item }) !item.builtin);
                }
            });


        commands.add(["fini[sh]"],
            "Stop sourcing a script file",
            function (args) {
                dactyl.assert(args.context, "E168: :finish used outside of a sourced file");
                args.context.finished = true;
            },
            { argCount: "0" });


        function checkStack(cmd) {
            util.assert(contexts.context && contexts.context.stack &&
                        contexts.context.stack[cmd] && contexts.context.stack[cmd].length,
                        "Invalid use of conditional");
        }
        function pop(cmd) {
            checkStack(cmd);
            return contexts.context.stack[cmd].pop();
        }
        function push(cmd, value) {
            util.assert(contexts.context, "Invalid use of conditional");
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
    completion: function initCompletion() {
        completion.group = function group(context, active) {
            context.title = ["Group"];
            let uri = buffer.uri;
            context.keys = {
                active: function (group) group.filter(uri),
                text: "name",
                description: function (g) <>{g.filter.toXML ? g.filter.toXML() + <>&#xa0;</> : ""}{g.description || ""}</>
            };
            context.completions = (active === undefined ? contexts.groupList : contexts.activeGroups(active))
                                    .slice(0, -1);

            iter({ Active: true, Inactive: false }).forEach(function ([name, active]) {
                context.split(name, null, function (context) {
                    context.title[0] = name + " Groups";
                    context.filters.push(function (item) item.active == active);
                });
            });
        };
    }
});

