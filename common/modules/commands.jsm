// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("commands", {
    exports: ["ArgType", "Command", "Commands", "CommandOption", "Ex", "commands"],
    use: ["config", "options", "template", "util"]
}, this);


/** @scope modules */

/**
 * A structure representing the options available for a command.
 *
 * Do NOT create instances of this class yourself, use the helper method
 * {@see Commands#add} instead
 *
 * @property {[string]} names An array of option names. The first name
 *     is the canonical option name.
 * @property {number} type The option's value type. This is one of:
 *         (@link CommandOption.NOARG),
 *         (@link CommandOption.STRING),
 *         (@link CommandOption.BOOL),
 *         (@link CommandOption.INT),
 *         (@link CommandOption.FLOAT),
 *         (@link CommandOption.LIST),
 *         (@link CommandOption.ANY)
 * @property {function} validator A validator function
 * @property {function (CompletionContext, object)} completer A list of
 *    completions, or a completion function which will be passed a
 *    {@link CompletionContext} and an object like that returned by
 *    {@link commands.parseArgs} with the following additional keys:
 *      completeOpt - The name of the option currently being completed.
 * @property {boolean} multiple Whether this option can be specified multiple times
 * @property {string} description A description of the option
 * @property {object} default The option's default value
 */

var CommandOption = Struct("names", "type", "validator", "completer", "multiple", "description", "default");
CommandOption.defaultValue("description", function () "");
CommandOption.defaultValue("type", function () CommandOption.NOARG);
CommandOption.defaultValue("multiple", function () false);

var ArgType = Struct("description", "parse");
update(CommandOption, {
    /**
     * @property {object} The option argument is unspecified. Any argument
     *     is accepted and caller is responsible for parsing the return
     *     value.
     * @final
     */
    ANY: 0,

    /**
     * @property {object} The option doesn't accept an argument.
     * @final
     */
    NOARG: ArgType("no arg",  function (arg) !arg || null),
    /**
     * @property {object} The option accepts a boolean argument.
     * @final
     */
    BOOL: ArgType("boolean", function (val) Commands.parseBool(val)),
    /**
     * @property {object} The option accepts a string argument.
     * @final
     */
    STRING: ArgType("string", function (val) val),
    /**
     * @property {object} The option accepts an integer argument.
     * @final
     */
    INT: ArgType("int", function (val) parseInt(val)),
    /**
     * @property {object} The option accepts a float argument.
     * @final
     */
    FLOAT: ArgType("float", function (val) parseFloat(val)),
    /**
     * @property {object} The option accepts a string list argument.
     *     E.g. "foo,bar"
     * @final
     */
    LIST: ArgType("list", function (arg, quoted) Option.splitList(quoted))
});

/**
 * A class representing Ex commands. Instances are created by
 * the {@link Commands} class.
 *
 * @param {string[]} specs The names by which this command can be invoked.
 *     These are specified in the form "com[mand]" where "com" is a unique
 *     command name prefix.
 * @param {string} description A short one line description of the command.
 * @param {function} action The action invoked by this command when executed.
 * @param {Object} extraInfo An optional extra configuration hash. The
 *     following properties are supported.
 *         argCount    - see {@link Command#argCount}
 *         bang        - see {@link Command#bang}
 *         completer   - see {@link Command#completer}
 *         count       - see {@link Command#count}
 *         domains     - see {@link Command#domains}
 *         heredoc     - see {@link Command#heredoc}
 *         literal     - see {@link Command#literal}
 *         options     - see {@link Command#options}
 *         privateData - see {@link Command#privateData}
 *         serialize   - see {@link Command#serialize}
 *         subCommand  - see {@link Command#subCommand}
 * @optional
 * @private
 */
var Command = Class("Command", {
    init: function (specs, description, action, extraInfo) {
        specs = Array.concat(specs); // XXX
        let parsedSpecs = extraInfo.parsedSpecs || Command.parseSpecs(specs);

        this.specs = specs;
        this.shortNames = array.compact(parsedSpecs.map(function (n) n[1]));
        this.longNames = parsedSpecs.map(function (n) n[0]);
        this.name = this.longNames[0];
        this.names = array.flatten(parsedSpecs);
        this.description = description;
        this.action = action;

        if (extraInfo)
            update(this, extraInfo);
        if (this.options)
            this.options = this.options.map(CommandOption.fromArray, CommandOption);
    },

    get toStringParams() [this.name, this.hive.name],

    get helpTag() ":" + this.name,

    get lastCommand() this._lastCommand || commandline.command,
    set lastCommand(val) { this._lastCommand = val; },

    /**
     * Execute this command.
     *
     * @param {Args} args The Args object passed to {@link #action}.
     * @param {Object} modifiers Any modifiers to be passed to {@link #action}.
     */
    execute: function (args, modifiers) {
        const { dactyl } = this.modules;

        let context = args.context;
        if (this.deprecated && !set.add(this.complained, context ? context.file : "[Command Line]")) {
            let loc = contexts.context ? context.file + ":" + context.line + ": " : "";
            dactyl.echoerr(loc + ":" + this.name + " is deprecated" +
                           (isString(this.deprecated) ? ": " + this.deprecated : ""));
        }

        modifiers = modifiers || {};

        if (args.count != null && !this.count)
            throw FailedAssertion("E481: No range allowed");
        if (args.bang && !this.bang)
            throw FailedAssertion("E477: No ! allowed");

        return !dactyl.trapErrors(function exec() {
            let extra = this.hive.argsExtra(args);
            for (let k in properties(extra))
                if (!(k in args))
                    Object.defineProperty(args, k, Object.getOwnPropertyDescriptor(extra, k));

            if (this.always)
                this.always(args, modifiers);

            if (!context || !context.noExecute)
                this.action(args, modifiers);
        }, this);
    },

    /**
     * Returns whether this command may be invoked via *name*.
     *
     * @param {string} name The candidate name.
     * @returns {boolean}
     */
    hasName: function (name) this.parsedSpecs.some(
        function ([long, short]) name.indexOf(short) == 0 && long.indexOf(name) == 0),

    /**
     * A helper function to parse an argument string.
     *
     * @param {string} args The argument string to parse.
     * @param {CompletionContext} complete A completion context.
     *     Non-null when the arguments are being parsed for completion
     *     purposes.
     * @param {Object} extra Extra keys to be spliced into the
     *     returned Args object.
     * @returns {Args}
     * @see Commands#parseArgs
     */
    parseArgs: function parseArgs(args, complete, extra) this.modules.commands.parseArgs(args, {
        __proto__: this,
        complete: complete,
        extra: extra
    }),

    complained: Class.memoize(function () ({})),

    /**
     * @property {string[]} All of this command's name specs. e.g., "com[mand]"
     */
    specs: null,
    /** @property {string[]} All of this command's short names, e.g., "com" */
    shortNames: null,
    /**
     * @property {string[]} All of this command's long names, e.g., "command"
     */
    longNames: null,

    /** @property {string} The command's canonical name. */
    name: null,
    /** @property {string[]} All of this command's long and short names. */
    names: null,

    /** @property {string} This command's description, as shown in :listcommands */
    description: "",
    /**
     * @property {function (Args)} The function called to execute this command.
     */
    action: null,
    /**
     * @property {string} This command's argument count spec.
     * @see Commands#parseArguments
     */
    argCount: 0,
    /**
     * @property {function (CompletionContext, Args)} This command's completer.
     * @see CompletionContext
     */
    completer: null,
    /** @property {boolean} Whether this command accepts a here document. */
    hereDoc: false,
    /**
     * @property {boolean} Whether this command may be called with a bang,
     *     e.g., :com!
     */
    bang: false,
    /**
     * @property {boolean} Whether this command may be called with a count,
     *     e.g., :12bdel
     */
    count: false,
    /**
     * @property {function(args)} A function which should return a list
     *     of domains referenced in the given args. Used in determining
     *     whether to purge the command from history when clearing
     *     private data.
     */
    domains: function (args) [],
    /**
     * @property {boolean} At what index this command's literal arguments
     *     begin. For instance, with a value of 2, all arguments starting with
     *     the third are parsed as a single string, with all quoting characters
     *     passed literally. This is especially useful for commands which take
     *     key mappings or Ex command lines as arguments.
     */
    literal: null,
    /**
     * @property {Array} The options this command takes.
     * @see Commands@parseArguments
     */
    options: [],
    optionMap: Class.memoize(function () array(this.options)
                .map(function (opt) opt.names.map(function (name) [name, opt]))
                .flatten().toObject()),
    newArgs: function (base) {
        let res = [];
        update(res, base);
        res.__proto__ = this.argsPrototype;
        return res;
    },
    argsPrototype: Class.memoize(function () update([],
            array(this.options).filter(function (opt) opt.default !== undefined)
                               .map(function (opt) [opt.names[0], Class.Property(Object.getOwnPropertyDescriptor(opt, "default"))])
                               .toObject(),
            {
                __iterator__: function () array.iterItems(this),

                command: this,

                explicitOpts: Class.memoize(function () ({})),

                has: function (opt) set.has(this.explicitOpts, opt) || typeof opt === "number" && set.has(this, opt),

                get literalArg() this.command.literal != null && this[this.command.literal] || "",

                // TODO: string: Class.memoize(function () { ... }),
                verify: function verify() {
                    if (this.command.argCount) {
                        util.assert((this.length > 0 || !/^[1+]$/.test(this.command.argCount)) &&
                                    (this.literal == null || !/[1+]/.test(this.command.argCount) || /\S/.test(this.literalArg || "")),
                                     "E471: Argument required");

                        util.assert((this.length == 0 || this.command.argCount !== "0") &&
                                    (this.length <= 1 || !/^[01?]$/.test(this.command.argCount)),
                                    "E488: Trailing characters");
                    }
                }
            })),
    /**
     * @property {boolean|function(args)} When true, invocations of this
     *     command may contain private data which should be purged from
     *     saved histories when clearing private data. If a function, it
     *     should return true if an invocation with the given args
     *     contains private data
     */
    privateData: true,
    /**
     * @property {function} Should return an array of *Object*s suitable to be
     *     passed to {@link Commands#commandToString}, one for each past
     *     invocation which should be restored on subsequent @dactyl startups.
     */
    serialize: null,
    serialGroup: 50,
    /**
     * @property {number} If this command takes another ex command as an
     *     argument, the index of that argument. Used in determining whether to
     *     purge the command from history when clearing private data.
     */
    subCommand: null,
    /**
     * @property {boolean} Specifies whether this is a user command. User
     *     commands may be created by plugins, or directly by users, and,
     *     unlike basic commands, may be overwritten. Users and plugin authors
     *     should create only user commands.
     */
    user: false,
    /**
     * @property {string} For commands defined via :command, contains the Ex
     *     command line to be executed upon invocation.
     */
    replacementText: null
}, {
    // TODO: do we really need more than longNames as a convenience anyway?
    /**
     *  Converts command name abbreviation specs of the form
     *  'shortname[optional-tail]' to short and long versions:
     *      ["abc[def]", "ghijkl"] ->  [["abcdef", "abc"], ["ghijlk"]]
     *
     *  @param {Array} specs An array of command name specs to parse.
     *  @returns {Array}
     */
    parseSpecs: function parseSpecs(specs) {
        return specs.map(function (spec) {
            let [, head, tail] = /([^[]+)(?:\[(.*)])?/.exec(spec);
            return tail ? [head + tail, head] : [head];
        });
    }
});

// Prototype.
var Ex = Module("Ex", {
    Local: function Local(dactyl, modules, window) ({
        get commands() modules.commands,
        get context() modules.contexts.context
    }),

    _args: function (cmd, args) {
        args = Array.slice(args);

        let res = cmd.newArgs({ context: this.context });
        if (isObject(args[0]))
            for (let [k, v] in Iterator(args.shift()))
                if (k == "!")
                    res.bang = v;
                else if (k == "#")
                    res.count = v;
                else {
                    let opt = cmd.optionMap["-" + k];
                    let val = opt.type && opt.type.parse(v);
                    util.assert(val != null && (typeof val !== "number" || !isNaN(val)),
                                "No such option: " + k);
                    Class.replaceProperty(args, opt.names[0], val);
                    args.explicitOpts[opt.names[0]] = val;
                }
        for (let [i, val] in array.iterItems(args))
            res[i] = String(val);
        return res;
    },

    _complete: function (cmd) let (self = this)
        function _complete(context, func, obj, args) {
            args = self._args(cmd, args);
            args.completeArg = args.length - 1;
            if (cmd.completer && args.length)
                return cmd.completer(context, args);
        },

    _run: function (name) {
        const self = this;
        let cmd = this.commands.get(name);
        util.assert(cmd, "No such command");

        return update(function exCommand(options) {
            let args = self._args(cmd, arguments);
            args.verify();
            return cmd.execute(args);
        }, {
            dactylCompleter: self._complete(cmd)
        });
    },

    __noSuchMethod__: function (meth, args) this._run(meth).apply(this, args)
});

/**
 * @instance commands
 */
var Commands = Module("commands", {
    lazyInit: true,

    Local: function Local(dactyl, modules, window) let ({ Group, contexts } = modules) ({
        init: function () {
            this.Command = Class("Command", Command, { modules: modules });
            this.user = contexts.hives.commands.user;
            this.builtin = contexts.hives.commands.builtin;
        },

        get context() contexts.context,

        get readHeredoc() modules.io.readHeredoc,

        hives: Group.Hives("commands", Class("CommandHive", Group.Hive, {
            init: function init(group) {
                init.supercall(this, group);
                this._map = {};
                this._list = [];
            },

            /** @property {Iterator(Command)} @private */
            __iterator__: function () array.iterValues(this._list.sort(function (a, b) a.name > b.name)),

            /** @property {string} The last executed Ex command line. */
            repeat: null,

            /**
             * Adds a new command.
             *
             * @param {string[]} names The names by which this command can be
             *     invoked. The first name specified is the command's canonical
             *     name.
             * @param {string} description A description of the command.
             * @param {function} action The action invoked by this command.
             * @param {Object} extra An optional extra configuration hash.
             * @optional
             */
            add: function (names, description, action, extra, replace) {
                const { commands } = modules;

                extra = extra || {};
                if (!extra.definedAt)
                    extra.definedAt = contexts.getCaller(Components.stack.caller);

                extra.hive = this;
                extra.parsedSpecs = Command.parseSpecs(names);

                let names = array.flatten(extra.parsedSpecs);
                let name = names[0];

                util.assert(!names.some(function (name) name in commands.builtin._map),
                            "E182: Can't replace non-user command: " + name);

                util.assert(replace || names.every(function (name) !(name in this._map), this),
                            "Not replacing command " + name);

                for (let name in values(names)) {
                    ex.__defineGetter__(name, function () this._run(name));
                    if (name in this._map)
                        this.remove(name);
                }

                let self = this;
                let closure = function () self._map[name];

                memoize(this._map, name, function () commands.Command(names, description, action, extra));
                memoize(this._list, this._list.length, closure);
                for (let alias in values(names.slice(1)))
                    memoize(this._map, alias, closure);

                return name;
            },

            _add: function (names, description, action, extra, replace) {
                extra = extra || {};
                extra.definedAt = contexts.getCaller(Components.stack.caller.caller);
                return this.add.apply(this, arguments);
            },

            /**
             * Clear all commands.
             * @returns {Command}
             */
            clear: function clear() {
                util.assert(this.group !== contexts.default,
                            "Cannot delete non-user commands");
                this._map = {};
                this._list = [];
            },

            /**
             * Returns the command with matching *name*.
             *
             * @param {string} name The name of the command to return. This can be
             *     any of the command's names.
             * @param {boolean} full If true, only return a command if one of
             *     its names matches *name* exactly.
             * @returns {Command}
             */
            get: function get(name, full) this._map[name]
                    || !full && array.nth(this._list, function (cmd) cmd.hasName(name), 0)
                    || null,

            /**
             * Remove the user-defined command with matching *name*.
             *
             * @param {string} name The name of the command to remove. This can be
             *     any of the command's names.
             */
            remove: function remove(name) {
                util.assert(this.group !== contexts.default,
                            "Cannot delete non-user commands");

                let cmd = this.get(name);
                this._list = this._list.filter(function (c) c !== cmd);
                for (let name in values(cmd.names))
                    delete this._map[name];
            }
        })),

        get allHives() contexts.allGroups.commands,

        get userHives() this.allHives.filter(function (h) h !== this.builtin, this),

        /**
         * Executes an Ex command script.
         *
         * @param {string} string A string containing the commands to execute.
         * @param {object} tokens An optional object containing tokens to be
         *      interpolated into the command string.
         * @param {object} args Optional arguments object to be passed to
         *      command actions.
         * @param {object} context An object containing information about
         *      the file that is being or has been sourced to obtain the
         *      command string.
         */
        execute: function (string, tokens, silent, args, context) {
            contexts.withContext(context || this.context || { file: "[Command Line]", line: 1 },
                                 function (context) {
                modules.io.withSavedValues(["readHeredoc"], function () {
                    this.readHeredoc = function (end) {
                        let res = [];
                        contexts.context.line++;
                        while (++i < lines.length) {
                            if (lines[i] === end)
                                return res.join("\n");
                            res.push(lines[i]);
                        }
                        util.assert(false, "Unexpected end of file waiting for " + end);
                    };

                    args = update({}, args || {});

                    if (tokens && !callable(string))
                        string = util.compileMacro(string, true);
                    if (callable(string))
                        string = string(tokens || {});

                    let lines = string.split(/\r\n|[\r\n]/);
                    let startLine = context.line;

                    for (var i = 0; i < lines.length && !context.finished; i++) {
                        // Deal with editors from Silly OSs.
                        let line = lines[i].replace(/\r$/, "");

                        context.line = startLine + i;

                        // Process escaped new lines
                        while (i < lines.length && /^\s*\\/.test(lines[i + 1]))
                            line += "\n" + lines[++i].replace(/^\s*\\/, "");

                        try {
                            dactyl.execute(line, args);
                        }
                        catch (e) {
                            if (!silent) {
                                e.message = context.file + ":" + context.line + ": " + e.message;
                                dactyl.reportError(e, true);
                            }
                        }
                    }
                });
            });
        },

        /**
         * Displays a list of user-defined commands.
         */
        list: function list() {
            function completerToString(completer) {
                if (completer)
                    return [k for ([k, v] in Iterator(config.completers)) if (completer == completion.closure[v])][0] || "custom";
                return "";
            }

            if (!this.userHives.some(function (h) h._list.length))
                dactyl.echomsg("No user-defined commands found");
            else
                modules.commandline.commandOutput(
                    <table>
                        <tr highlight="Title">
                            <td/>
                            <td style="padding-right: 1em;"></td>
                            <td style="padding-right: 1ex;">Name</td>
                            <td style="padding-right: 1ex;">Args</td>
                            <td style="padding-right: 1ex;">Range</td>
                            <td style="padding-right: 1ex;">Complete</td>
                            <td style="padding-right: 1ex;">Definition</td>
                        </tr>
                        <col style="min-width: 6em; padding-right: 1em;"/>
                        {
                            template.map(this.userHives, function (hive) let (i = 0)
                                <tr style="height: .5ex;"/> +
                                template.map(hive, function (cmd)
                                    template.map(cmd.names, function (name)
                                    <tr>
                                        <td highlight="Title">{!i++ ? hive.name : ""}</td>
                                        <td>{cmd.bang ? "!" : " "}</td>
                                        <td>{cmd.name}</td>
                                        <td>{cmd.argCount}</td>
                                        <td>{cmd.count ? "0c" : ""}</td>
                                        <td>{completerToString(cmd.completer)}</td>
                                        <td>{cmd.replacementText || "function () { ... }"}</td>
                                    </tr>)) +
                                <tr style="height: .5ex;"/>)
                        }
                    </table>);
        }
    }),

    /**
     * @property Indicates that no count was specified for this
     *     command invocation.
     * @final
     */
    COUNT_NONE: null,
    /**
     * @property {number} Indicates that the full buffer range (1,$) was
     *     specified for this command invocation.
     * @final
     */
    // FIXME: this isn't a count at all
    COUNT_ALL: -2, // :%...

    /** @property {Iterator(Command)} @private */
    iterator: function () iter.apply(null, this.hives)
                              .sort(function (a, b) a.serialGroup - b.serialGroup || a.name > b.name)
                              .iterValues(),

    /** @property {string} The last executed Ex command line. */
    repeat: null,

    add: function () this.builtin._add.apply(this.builtin, arguments),
    addUserCommand: deprecated("commands.user.add", { get: function addUserCommand() this.user.closure._add }),
    getUserCommands: deprecated("iter(commands.user)", function getUserCommands() iter(this.user).toArray()),
    removeUserCommand: deprecated("commands.user.remove", { get: function removeUserCommand() this.user.closure.remove }),

    /**
     * Returns the specified command invocation object serialized to
     * an executable Ex command string.
     *
     * @param {Object} args The command invocation object.
     * @returns {string}
     */
    commandToString: function (args) {
        let res = [args.command + (args.bang ? "!" : "")];

        let defaults = {};
        if (args.ignoreDefaults)
            defaults = array(this.options).map(function (opt) [opt.names[0], opt.default]).toObject();

        for (let [opt, val] in Iterator(args.options || {})) {
            if (val != null && defaults[opt] === val)
                continue;
            let chr = /^-.$/.test(opt) ? " " : "=";
            if (val != null)
                opt += chr + Commands.quote(val);
            res.push(opt);
        }
        for (let [, arg] in Iterator(args.arguments || []))
            res.push(Commands.quote(arg));

        let str = args.literalArg;
        if (str)
            res.push(!/\n/.test(str) ? str :
                     this.hereDoc && false ? "<<EOF\n" + String.replace(str, /\n$/, "") + "\nEOF"
                                           : String.replace(str, /\n/g, "\n" + res[0].replace(/./g, " ").replace(/.$/, "\\")));
        return res.join(" ");
    },

    /**
     * Returns the command with matching *name*.
     *
     * @param {string} name The name of the command to return. This can be
     *     any of the command's names.
     * @returns {Command}
     */
    get: function (name, full) iter(this.hives).map(function ([i, hive]) hive.get(name, full))
                                               .nth(util.identity, 0),

    /**
     * Returns true if a command invocation contains a URL referring to the
     * domain *host*.
     *
     * @param {string} command
     * @param {string} host
     * @returns {boolean}
     */
    hasDomain: function (command, host) {
        try {
            for (let [cmd, args] in this.subCommands(command))
                if (Array.concat(cmd.domains(args)).some(function (domain) util.isSubdomain(domain, host)))
                    return true;
        }
        catch (e) {
            util.reportError(e);
        }
        return false;
    },

    /**
     * Returns true if a command invocation contains private data which should
     * be cleared when purging private data.
     *
     * @param {string} command
     * @returns {boolean}
     */
    hasPrivateData: function (command) {
        for (let [cmd, args] in this.subCommands(command))
            if (cmd.privateData)
                return !callable(cmd.privateData) || cmd.privateData(args);
        return false;
    },

    // TODO: should it handle comments?
    //     : it might be nice to be able to specify that certain quoting
    //     should be disabled E.g. backslash without having to resort to
    //     using literal etc.
    //     : error messages should be configurable or else we can ditch
    //     Vim compatibility but it actually gives useful messages
    //     sometimes rather than just "Invalid arg"
    //     : I'm not sure documenting the returned object here, and
    //     elsewhere, as type Args rather than simply Object makes sense,
    //     especially since it is further augmented for use in
    //     Command#action etc.
    /**
     * Parses *str* for options and plain arguments.
     *
     * The returned *Args* object is an augmented array of arguments.
     * Any key/value pairs of *extra* will be available and the
     * following additional properties:
     *     -opt       - the value of the option -opt if specified
     *     string     - the original argument string *str*
     *     literalArg - any trailing literal argument
     *
     * Quoting rules:
     *     '-quoted strings   - only ' and \ itself are escaped
     *     "-quoted strings   - also ", \n and \t are translated
     *     non-quoted strings - everything is taken literally apart from "\
     *                          " and "\\"
     *
     * @param {string} str The Ex command-line string to parse. E.g.
     *     "-x=foo -opt=bar arg1 arg2"
     * @param {[CommandOption]} options The options accepted. These are specified
     *      as an array of {@link CommandOption} structures.
     * @param {string} argCount The number of arguments accepted.
     *            "0": no arguments
     *            "1": exactly one argument
     *            "+": one or more arguments
     *            "*": zero or more arguments (default if unspecified)
     *            "?": zero or one arguments
     * @param {boolean} allowUnknownOptions Whether unspecified options
     *     should cause an error.
     * @param {number} literal The index at which any literal arg begins.
     *     See {@link Command#literal}.
     * @param {CompletionContext} complete The relevant completion context
     *     when the args are being parsed for completion.
     * @param {Object} extra Extra keys to be spliced into the returned
     *     Args object.
     * @returns {Args}
     */
    parseArgs: function parseArgs(str, params) {
        const self = this;

        function getNextArg(str, _keepQuotes) {
            if (arguments.length < 2)
                _keepQuotes = keepQuotes;

            if (str.substr(0, 2) === "<<" && hereDoc) {
                let arg = /^<<(\S*)/.exec(str)[1];
                let count = arg.length + 2;
                if (complete)
                    return [count, "", ""];
                return [count, self.readHeredoc(arg), ""];
            }

            let [count, arg, quote] = Commands.parseArg(str, null, _keepQuotes);
            if (quote == "\\" && !complete)
                return [, , , "Trailing \\"];
            if (quote && !complete)
                return [, , , "E114: Missing quote: " + quote];
            return [count, arg, quote];
        }

        try {

            var { allowUnknownOptions, argCount, complete, extra, hereDoc, literal, options, keepQuotes } = params || {};

            if (!options)
                options = [];

            if (!argCount)
                argCount = "*";

            var args = params.newArgs ? params.newArgs() : [];
            args.string = str; // for access to the unparsed string

            // FIXME!
            for (let [k, v] in Iterator(extra || []))
                args[k] = v;

            // FIXME: best way to specify these requirements?
            var onlyArgumentsRemaining = allowUnknownOptions || options.length == 0; // after a -- has been found
            var arg = null;
            var i = 0;
            var completeOpts;

            // XXX
            let matchOpts = function matchOpts(arg) {
                // Push possible option matches into completions
                if (complete && !onlyArgumentsRemaining)
                    completeOpts = options.filter(function (opt) opt.multiple || !set.has(args, opt.names[0]));
            };
            let resetCompletions = function resetCompletions() {
                completeOpts = null;
                args.completeArg = null;
                args.completeOpt = null;
                args.completeFilter = null;
                args.completeStart = i;
                args.quote = Commands.complQuote[""];
            };
            if (complete) {
                resetCompletions();
                matchOpts("");
                args.completeArg = 0;
            }

            let fail = function fail(error) {
                if (complete)
                    complete.message = error;
                else
                    util.assert(false, error);
            };

            outer:
            while (i < str.length || complete) {
                var argStart = i;
                let re = /\s*/gy;
                re.lastIndex = i;
                i += re.exec(str)[0].length;

                if (str[i] == "|") {
                    args.string = str.slice(0, i);
                    args.trailing = str.slice(i + 1);
                    break;
                }
                if (i == str.length && !complete)
                    break;

                if (complete)
                    resetCompletions();

                var sub = str.substr(i);
                if ((!onlyArgumentsRemaining) && /^--(\s|$)/.test(sub)) {
                    onlyArgumentsRemaining = true;
                    i += 2;
                    continue;
                }

                var optname = "";
                if (!onlyArgumentsRemaining) {
                    for (let [, opt] in Iterator(options)) {
                        for (let [, optname] in Iterator(opt.names)) {
                            if (sub.indexOf(optname) == 0) {
                                let count = 0;
                                let invalid = false;
                                let arg, uote, quoted;

                                let sep = sub[optname.length];
                                if (sep == "=" || /\s/.test(sep) && opt.type != CommandOption.NOARG) {
                                    [count, quoted, quote, error] = getNextArg(sub.substr(optname.length + 1), true);
                                    arg = Option.dequote(quoted);
                                    util.assert(!error, error);

                                    // if we add the argument to an option after a space, it MUST not be empty
                                    if (sep != "=" && !quote && arg.length == 0)
                                        arg = null;

                                    count++; // to compensate the "=" character
                                }
                                else if (!/\s/.test(sep) && sep != undefined) // this isn't really an option as it has trailing characters, parse it as an argument
                                    invalid = true;

                                let context = null;
                                if (!complete && quote)
                                    fail("Invalid argument for option " + optname);

                                if (!invalid) {
                                    if (complete && !/[\s=]/.test(sep))
                                        matchOpts(sub);

                                    if (complete && count > 0) {
                                        args.completeStart += optname.length + 1;
                                        args.completeOpt = opt;
                                        args.completeFilter = arg;
                                        args.quote = Commands.complQuote[quote] || Commands.complQuote[""];
                                    }
                                    if (!complete || arg != null) {
                                        if (opt.type) {
                                            let orig = arg;
                                            arg = opt.type.parse(arg, quoted);

                                            if (complete && isArray(arg)) {
                                                args.completeFilter = arg[arg.length - 1] || "";
                                                args.completeStart += orig.length - args.completeFilter.length;
                                            }

                                            if (arg == null || (typeof arg == "number" && isNaN(arg))) {
                                                if (!complete || orig != "" || args.completeStart != str.length)
                                                    fail("Invalid argument for " + opt.type.description + " option: " + optname);
                                                if (complete)
                                                    complete.highlight(args.completeStart, count - 1, "SPELLCHECK");
                                            }
                                        }

                                        // we have a validator function
                                        if (typeof opt.validator == "function") {
                                            if (opt.validator(arg, quoted) == false && (arg || !complete)) {
                                                fail("Invalid argument for option: " + optname);
                                                if (complete) // Always true.
                                                    complete.highlight(args.completeStart, count - 1, "SPELLCHECK");
                                            }
                                        }
                                    }

                                    if (arg != null || opt.type == CommandOption.NOARG) {
                                        // option allowed multiple times
                                        if (opt.multiple)
                                            args[opt.names[0]] = (args[opt.names[0]] || []).concat(arg);
                                        else
                                            Class.replaceProperty(args, opt.names[0], opt.type == CommandOption.NOARG || arg);

                                        args.explicitOpts[opt.names[0]] = args[opt.names[0]];
                                    }

                                    i += optname.length + count;
                                    if (i == str.length)
                                        break outer;
                                    continue outer;
                                }
                                // if it is invalid, just fall through and try the next argument
                            }
                        }
                    }
                }

                matchOpts(sub);

                if (complete)
                    if (argCount == "0" || args.length > 0 && (/[1?]/.test(argCount)))
                        complete.highlight(i, sub.length, "SPELLCHECK");

                if (args.length === literal) {
                    if (complete)
                        args.completeArg = args.length;

                    let re = /(?:\s*(?=\n)|\s*)([^]*)/gy;
                    re.lastIndex = argStart || 0;
                    sub = re.exec(str)[1];

                    // Hack.
                    if (sub.substr(0, 2) === "<<" && hereDoc)
                        let ([count, arg] = getNextArg(sub)) {
                            sub = arg + sub.substr(count);
                        }

                    args.push(sub);
                    args.quote = null;
                    break;
                }

                // if not an option, treat this token as an argument
                let [count, arg, quote, error] = getNextArg(sub);
                util.assert(!error, error);

                if (complete) {
                    args.quote = Commands.complQuote[quote] || Commands.complQuote[""];
                    args.completeFilter = arg || "";
                }
                else if (count == -1)
                    fail("Error parsing arguments: " + arg);
                else if (!onlyArgumentsRemaining && sub[0] === "-")
                    fail("Invalid option: " + arg);

                if (arg != null)
                    args.push(arg);
                if (complete)
                    args.completeArg = args.length - 1;

                i += count;
                if (count <= 0 || i == str.length)
                    break;
            }

            if (complete && args.trailing == null) {
                if (args.completeOpt) {
                    let opt = args.completeOpt;
                    let context = complete.fork(opt.names[0], args.completeStart);
                    let arg = args.explicitOpts[opt.names[0]];
                    context.filter = args.completeFilter;

                    if (isArray(arg))
                        context.filters.push(function (item) arg.indexOf(item.text) === -1);

                    if (typeof opt.completer == "function")
                        var compl = opt.completer(context, args);
                    else
                        compl = opt.completer || [];

                    context.title = [opt.names[0]];
                    context.quote = args.quote;
                    if (compl)
                        context.completions = compl;
                }
                complete.advance(args.completeStart);
                complete.keys = { text: "names", description: "description" };
                complete.title = ["Options"];
                if (completeOpts)
                    complete.completions = completeOpts;
            }

            if (args.verify)
                args.verify();

            return args;
        }
        catch (e if complete && e instanceof FailedAssertion) {
            complete.message = e;
            return args;
        }
    },

    nameRegexp: util.regexp(<![CDATA[
            [^
                0-9
                <forbid>
            ]
            [^ <forbid> ]*
        ]]>, "g", {
        forbid: util.regexp(String.replace(<![CDATA[
            U0000-U002c // U002d -
            U002e-U002f
            U003a-U0040 // U0041-U005a a-z
            U005b-U0060 // U0061-U007a A-Z
            U007b-U00bf
            U02b0-U02ff // Spacing Modifier Letters
            U0300-U036f // Combining Diacritical Marks
            U1dc0-U1dff // Combining Diacritical Marks Supplement
            U2000-U206f // General Punctuation
            U20a0-U20cf // Currency Symbols
            U20d0-U20ff // Combining Diacritical Marks for Symbols
            U2400-U243f // Control Pictures
            U2440-U245f // Optical Character Recognition
            U2500-U257f // Box Drawing
            U2580-U259f // Block Elements
            U2700-U27bf // Dingbats
            Ufe20-Ufe2f // Combining Half Marks
            Ufe30-Ufe4f // CJK Compatibility Forms
            Ufe50-Ufe6f // Small Form Variants
            Ufe70-Ufeff // Arabic Presentation Forms-B
            Uff00-Uffef // Halfwidth and Fullwidth Forms
            Ufff0-Uffff // Specials
        ]]>, /U/g, "\\u"))
    }),

    validName: Class.memoize(function () util.regexp("^" + this.nameRegexp.source + "$")),

    commandRegexp: Class.memoize(function () util.regexp(<![CDATA[
            ^
            (?P<spec>
                (?P<prespace> [:\s]*)
                (?P<count>    (?:\d+ | %)? )
                (?P<cmd>      (?:<name> | !)? )
                (?P<bang>     !?)
                (?P<space>    \s*)
            )
            (?P<args>
                (?:. | \n)*?
            )?
            $
        ]]>, "", {
            name: this.nameRegexp
        })),

    /**
     * Parses a complete Ex command.
     *
     * The parsed string is returned as an Array like
     * [count, command, bang, args]:
     *     count   - any count specified
     *     command - the Ex command name
     *     bang    - whether the special "bang" version was called
     *     args    - the commands full argument string
     * E.g. ":2foo! bar" -> [2, "foo", true, "bar"]
     *
     * @param {string} str The Ex command line string.
     * @returns {Array}
     */
    // FIXME: why does this return an Array rather than Object?
    parseCommand: function (str) {
        // remove comments
        str.replace(/\s*".*$/, "");

        let matches = this.commandRegexp.exec(str);
        if (!matches)
            return [];

        let [, spec, prespace, count, cmd, bang, space, args] = matches;
        if (!cmd && bang)
            [cmd, bang] = [bang, cmd];

        if (!cmd || args && args[0] != "|" && !(space || cmd == "!"))
            return [];

        // parse count
        if (count)
            count = count == "%" ? this.COUNT_ALL : parseInt(count, 10);
        else
            count = this.COUNT_NONE;

        return [count, cmd, !!bang, args || "", spec.length];
    },

    parseCommands: function (str, complete) {
        do {
            let [count, cmd, bang, args, len] = commands.parseCommand(str);
            let command = this.get(cmd || "");

            if (command == null) {
                yield [null, { commandString: str }];
                return;
            }

            if (complete) {
                complete.fork(command.name);
                var context = complete.fork("args", len);
            }

            if (!complete || /(\w|^)[!\s]/.test(str))
                args = command.parseArgs(args, context, { count: count, bang: bang });
            else
                args = this.parseArgs(args, { extra: { count: count, bang: bang } });
            args.context = this.context;
            args.commandName = cmd;
            args.commandString = str.substr(0, len) + args.string;
            str = args.trailing;
            yield [command, args];
            if (args.break)
                break;
        }
        while (str);
    },

    subCommands: function (command) {
        let commands = [command];
        while (command = commands.shift())
            try {
                for (let [command, args] in this.parseCommands(command)) {
                    if (command) {
                        yield [command, args];
                        if (command.subCommand && args[command.subCommand])
                            commands.push(args[command.subCommand]);
                    }
                }
            }
            catch (e) {}
    },

    /** @property */
    get complQuote() Commands.complQuote,

    /** @property */
    get quoteArg() Commands.quoteArg // XXX: better somewhere else?

}, {
    // returns [count, parsed_argument]
    parseArg: function parseArg(str, sep, keepQuotes) {
        let arg = "";
        let quote = null;
        let len = str.length;

        function fixEscapes(str) str.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4}|(.))/g, function (m, n1) n1 || m);

        // Fix me.
        if (isString(sep))
            sep = RegExp(sep);
        sep = sep != null ? sep : /\s/;
        let re1 = RegExp("^" + (sep.source === "" ? "(?!)" : sep.source));
        let re2 = RegExp(/^()((?:[^\\S"']|\\.)+)((?:\\$)?)/.source.replace("S", sep.source));

        while (str.length && !re1.test(str)) {
            let res;
            if ((res = re2.exec(str)))
                arg += keepQuotes ? res[0] : res[2].replace(/\\(.)/g, "$1");
            else if ((res = /^(")((?:[^\\"]|\\.)*)("?)/.exec(str)))
                arg += keepQuotes ? res[0] : JSON.parse(fixEscapes(res[0]) + (res[3] ? "" : '"'));
            else if ((res = /^(')((?:[^']|'')*)('?)/.exec(str)))
                arg += keepQuotes ? res[0] : res[2].replace("''", "'", "g");
            else
                break;

            if (!res[3])
                quote = res[1];
            if (!res[1])
                quote = res[3];
            str = str.substr(res[0].length);
        }

        return [len - str.length, arg, quote];
    },

    quote: function quote(str) Commands.quoteArg[
        /[\b\f\n\r\t]/.test(str)   ? '"' :
        /[\s"'\\]|^$|^-/.test(str) ? "'"
                                   : ""](str)
}, {
    completion: function initCompletion(dactyl, modules, window) {
        const { completion } = modules;

        completion.command = function command(context) {
            context.title = ["Command"];
            context.keys = { text: "longNames", description: "description" };
            context.generate = function () modules.commands.hives.map(function (h) h._list).flatten();
        };

        // provides completions for ex commands, including their arguments
        completion.ex = function ex(context) {
            const { commands } = modules;

            // if there is no space between the command name and the cursor
            // then get completions of the command name
            for (var [command, args] in commands.parseCommands(context.filter, context))
                if (args.trailing)
                    context.advance(args.commandString.length + 1);
            if (!args)
                args = { commandString: context.filter };

            let match = commands.commandRegexp.exec(args.commandString);
            if (!match)
                return;

            context.advance(match.prespace.length + match.count.length);
            if (!(match.bang || match.space)) {
                context.fork("", 0, this, "command");
                return;
            }

            // dynamically get completions as specified with the command's completer function
            context.highlight();
            if (!command) {
                context.message = "No such command: " + match.cmd;
                context.highlight(0, match.cmd.length, "SPELLCHECK");
                return;
            }

            let cmdContext = context.fork(command.name, match.cmd.length + match.bang.length + match.space.length);
            try {
                if (!cmdContext.waitingForTab) {
                    if (!args.completeOpt && command.completer && args.completeStart != null) {
                        cmdContext.advance(args.completeStart);
                        cmdContext.quote = args.quote;
                        cmdContext.filter = args.completeFilter;
                        command.completer.call(command, cmdContext, args);
                    }
                }
            }
            catch (e) {
                util.reportError(e);
            }
        };

        completion.userCommand = function userCommand(context, group) {
            context.title = ["User Command", "Definition"];
            context.keys = { text: "name", description: "replacementText" };
            context.completions = group || modules.commands.user;
        };
    },

    commands: function (dactyl, modules, window) {
        const { commands, contexts } = modules;

        // TODO: Vim allows commands to be defined without {rep} if there are {attr}s
        // specified - useful?
        commands.add(["com[mand]"],
            "List or define commands",
            function (args) {
                let cmd = args[0];

                util.assert(!cmd || cmd.split(",").every(commands.validName.closure.test),
                            "E182: Invalid command name");

                if (!args.literalArg)
                    commands.list();
                else {
                    util.assert(args["-group"] !== commands.builtin,
                                "Cannot change commands in the builtin group");

                    let completer  = args["-complete"];
                    let completerFunc = null; // default to no completion for user commands

                    if (completer) {
                        if (/^custom,/.test(completer)) {
                            completer = completer.substr(7);

                            let context = update({}, contexts.context || {});
                            completerFunc = function (context) {
                                try {
                                    var result = contextswithSavedValues(["context"], function () {
                                        contexts.context = context;
                                        return dactyl.userEval(completer);
                                    });
                                }
                                catch (e) {
                                    dactyl.echo(":" + this.name + " ...");
                                    dactyl.echoerr("E117: Unknown function: " + completer);
                                    dactyl.log(e);
                                    return undefined;
                                }
                                if (callable(result))
                                    return result.apply(this, Array.slice(arguments));
                                else
                                    return context.completions = result;
                            };
                        }
                        else
                            completerFunc = function (context) modules.completion.closure[config.completers[completer]](context);
                    }

                    let added = args["-group"].add(cmd.split(","),
                                    args["-description"],
                                    contexts.bindMacro(args, "-ex",
                                        function makeParams(args, modifiers) ({
                                            args: {
                                                __proto__: args,
                                                toString: function () this.string,
                                            },
                                            bang:  this.bang && args.bang ? "!" : "",
                                            count: this.count && args.count
                                        })),
                                    {
                                        argCount: args["-nargs"],
                                        bang: args["-bang"],
                                        count: args["-count"],
                                        completer: completerFunc,
                                        literal: args["-literal"],
                                        persist: !args["-nopersist"],
                                        replacementText: args.literalArg,
                                        context: contexts.context && update({}, contexts.context)
                                    }, args.bang);

                    if (!added)
                        dactyl.echoerr("E174: Command already exists: add ! to replace it");
                }
            }, {
                bang: true,
                completer: function (context, args) {
                    const { completion } = modules;
                    if (args.completeArg == 0)
                        completion.userCommand(context, args["-group"]);
                    else
                        args["-javascript"] ? completion.javascript(context) : completion.ex(context);
                },
                hereDoc: true,
                options: [
                    { names: ["-bang", "-b"],  description: "Command may be followed by a !" },
                    { names: ["-count", "-c"], description: "Command may be preceded by a count" },
                    {
                        // TODO: "E180: invalid complete value: " + arg
                        names: ["-complete", "-C"],
                        description: "The argument completion function",
                        completer: function (context) [[k, ""] for ([k, v] in Iterator(config.completers))],
                        type: CommandOption.STRING,
                        validator: function (arg) arg in config.completers || /^custom,/.test(arg),
                    },
                    {
                        names: ["-description", "-desc", "-d"],
                        description: "A user-visible description of the command",
                        default: "User-defined command",
                        type: CommandOption.STRING
                    },
                    contexts.GroupFlag("commands"),
                    {
                        names: ["-javascript", "-js", "-j"],
                        description: "Execute the definition as JavaScript rather than Ex commands"
                    },
                    {
                        names: ["-literal", "-l"],
                        description: "Process the nth ignoring any quoting or meta characters",
                        type: CommandOption.INT
                    },
                    {
                        names: ["-nargs", "-a"],
                        description: "The allowed number of arguments",
                        completer: [["0", "No arguments are allowed (default)"],
                                    ["1", "One argument is allowed"],
                                    ["*", "Zero or more arguments are allowed"],
                                    ["?", "Zero or one argument is allowed"],
                                    ["+", "One or more arguments are allowed"]],
                        default: "0",
                        type: CommandOption.STRING,
                        validator: function (arg) /^[01*?+]$/.test(arg)
                    },
                    {
                        names: ["-nopersist", "-n"],
                        description: "Do not save this command to an auto-generated RC file"
                    }
                ],
                literal: 1,

                serialize: function () array(commands.userHives)
                    .filter(function (h) h.persist)
                    .map(function (hive) [
                        {
                            command: this.name,
                            bang: true,
                            options: iter([v, typeof cmd[k] == "boolean" ? null : cmd[k]]
                                          // FIXME: this map is expressed multiple times
                                          for ([k, v] in Iterator({
                                              argCount: "-nargs",
                                              bang: "-bang",
                                              count: "-count",
                                              description: "-description"
                                          }))
                                          if (cmd[k])).toObject(),
                            arguments: [cmd.name],
                            literalArg: cmd.action,
                            ignoreDefaults: true
                        }
                        for (cmd in hive) if (cmd.persist)
                    ], this)
                    .flatten().array
            });

        commands.add(["comc[lear]"],
            "Delete all user-defined commands",
            function (args) {
                args["-group"].clear();
            },
            {
                argCount: "0",
                options: [contexts.GroupFlag("commands")]
            });

        commands.add(["comp[letions]"],
            "List the completion results for a given command substring",
            function (args) { modules.completion.listCompleter("ex", args[0]); },
            {
                argCount: "1",
                completer: function (context, args) modules.completion.ex(context),
                literal: 0
            });

        commands.add(["delc[ommand]"],
            "Delete the specified user-defined command",
            function (args) {
                let name = args[0];

                if (args["-group"].get(name))
                    args["-group"].remove(name);
                else
                    dactyl.echoerr("E184: No such user-defined command: " + name);
            }, {
                argCount: "1",
                completer: function (context, args) modules.completion.userCommand(context, args["-group"]),
                options: [contexts.GroupFlag("commands")]
            });

        dactyl.addUsageCommand({
            name: ["listc[ommands]", "lc"],
            description: "List all Ex commands along with their short descriptions",
            index: "ex-cmd",
            iterate: function (args) commands.iterator().map(function (cmd) ({
                __proto__: cmd,
                columns: [
                    cmd.hive == commands.builtin ? "" : <span highlight="Object" style="padding-right: 1em;">{cmd.hive.name}</span>
                ]
            })),
            format: {
                headings: ["Command", "Group", "Description"],
                description: function (cmd) template.linkifyHelp(cmd.description + (cmd.replacementText ? ": " + cmd.action : "")),
                help: function (cmd) ":" + cmd.name
            }
        });

        commands.add(["y[ank]"],
            "Yank the output of the given command to the clipboard",
            function (args) {
                let cmd = /^:/.test(args[0]) ? args[0] : ":echo " + args[0];

                let res = modules.commandline.withOutputToString(commands.execute, commands, cmd);

                dactyl.clipboardWrite(res);

                let lines = res.split("\n").length;
                dactyl.echomsg("Yanked " + lines + " line" + (lines == 1 ? "" : "s"));
            },
            {
                completer: function (context) modules.completion[/^:/.test(context.filter) ? "ex" : "javascript"](context),
                literal: 0
            });
    },
    javascript: function (dactyl, modules, window) {
        const { JavaScript, commands } = modules;

        JavaScript.setCompleter([commands.user.get, commands.user.remove],
                                [function () [[c.names, c.description] for (c in this)]]);
        JavaScript.setCompleter([commands.get],
                                [function () [[c.names, c.description] for (c in this.iterator())]]);
    },
    mappings: function (dactyl, modules, window) {
        const { commands, mappings, modes } = modules;

        mappings.add([modes.COMMAND],
            ["@:"], "Repeat the last Ex command",
            function (args) {
                if (commands.repeat) {
                    for (let i in util.interruptibleRange(0, Math.max(args.count, 1), 100))
                        dactyl.execute(commands.repeat);
                }
                else
                    dactyl.echoerr("E30: No previous command line");
            },
            { count: true });
    }
});

(function () {

    Commands.quoteMap = {
        "\n": "\\n",
        "\t": "\\t",
    };
    function quote(q, list, map) {
        map = map || Commands.quoteMap;
        let re = RegExp("[" + list + "]", "g");
        function quote(str) q + String.replace(str, re, function ($0) $0 in map ? map[$0] : ("\\" + $0)) + q;
        quote.list = list;
        return quote;
    };

    Commands.quoteArg = {
        '"': quote('"', '\n\t"\\\\'),
        "'": quote("'", "'", { "'": "''" }),
        "":  quote("",  "|\\\\\\s'\"")
    };
    Commands.complQuote = {
        '"': ['"', quote("", Commands.quoteArg['"'].list), '"'],
        "'": ["'", quote("", Commands.quoteArg["'"].list), "'"],
        "":  ["", Commands.quoteArg[""], ""]
    };

    Commands.parseBool = function (arg) {
        if (/^(true|1|on)$/i.test(arg))
            return true;
        if (/^(false|0|off)$/i.test(arg))
            return false;
        return NaN;
    };
})();

endModule();

} catch(e){ if (!e.stack) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
