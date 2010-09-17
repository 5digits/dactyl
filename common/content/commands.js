// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2009 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

// Do NOT create instances of this class yourself, use the helper method
// commands.add() instead

/**
 * A structure representing the options available for a command.
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
 */
const CommandOption = Struct("names", "type", "validator", "completer", "multiple", "description");
CommandOption.defaultValue("description", function () "");
CommandOption.defaultValue("type", function () CommandOption.NOARG);
CommandOption.defaultValue("multiple", function () false);
update(CommandOption, {
    // FIXME: remove later, when our option handler is better
    /**
     * @property {number} The option argument is unspecified. Any argument
     *     is accepted and caller is responsible for parsing the return
     *     value.
     * @final
     */
    ANY: 0,

    /**
     * @property {number} The option doesn't accept an argument.
     * @final
     */
    NOARG: 1,
    /**
     * @property {number} The option accepts a boolean argument.
     * @final
     */
    BOOL: 2,
    /**
     * @property {number} The option accepts a string argument.
     * @final
     */
    STRING: 3,
    /**
     * @property {number} The option accepts an integer argument.
     * @final
     */
    INT: 4,
    /**
     * @property {number} The option accepts a float argument.
     * @final
     */
    FLOAT: 5,
    /**
     * @property {number} The option accepts a string list argument.
     *     E.g. "foo,bar"
     * @final
     */
    LIST: 6
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
const Command = Class("Command", {
    init: function (specs, description, action, extraInfo) {
        specs = Array.concat(specs); // XXX
        let parsedSpecs = Command.parseSpecs(specs);

        this.specs = specs;
        this.shortNames = array(parsedSpecs).map(function (n) n[1]).compact();
        this.longNames = parsedSpecs.map(function (n) n[0]);
        this.name = this.longNames[0];
        this.names = array(parsedSpecs).flatten();
        this.description = description;
        this.action = action;

        if (extraInfo)
            update(this, extraInfo);
        if (this.options)
            this.options = this.options.map(CommandOption.fromArray, CommandOption);
    },

    /**
     * Execute this command.
     *
     * @param {string} args The args to be parsed and passed to
     *     {@link #action}.
     * @param {boolean} bang Whether this command was executed with a trailing
     *     bang.
     * @deprecated
     * @param {number} count Whether this command was executed with a leading
     *     count.
     * @deprecated
     * @param {Object} modifiers Any modifiers to be passed to {@link #action}.
     */
    execute: function (args, bang, count, modifiers) {
        // XXX
        bang = !!bang;
        count = (count === undefined) ? null : count;
        modifiers = modifiers || {};

        let self = this;
        function exec(command) {
            // FIXME: Move to parseCommand?
            args = this.parseArgs(command);
            args.count = count;
            args.bang = bang;
            this.action(args, modifiers);
        }

        if (this.hereDoc) {
            let matches = args.match(/(.*)<<\s*(\S+)$/);
            if (matches && matches[2]) {
                commandline.inputMultiline(RegExp("^" + matches[2] + "$", "m"),
                    function (args) { dactyl.trapErrors(exec, self, matches[1] + "\n" + args); });
                return;
            }
        }

        dactyl.trapErrors(exec, this, args);
    },

    /**
     * Returns whether this command may be invoked via <b>name</b>.
     *
     * @param {string} name The candidate name.
     * @returns {boolean}
     */
    hasName: function (name) {
        for (let [, spec] in Iterator(this.specs)) {
            let fullName = spec.replace(/\[(\w+)]$/, "$1");
            let index = spec.indexOf("[");
            let min = index == -1 ? fullName.length : index;

            if (fullName.indexOf(name) == 0 && name.length >= min)
                return true;
        }

        return false;
    },

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
    parseArgs: function (args, complete, extra) commands.parseArgs(args, this.options, this.argCount, false, this.literal, complete, extra),

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

    /** @property {string} This command's description, as shown in :exusage */
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
     *     of domains referenced in the given args. Used in determing
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
    /**
     * @property {boolean|function(args)} When true, invocations of this
     *     command may contain private data which should be purged from
     *     saved histories when clearing private data. If a function, it
     *     should return true if an invocation with the given args
     *     contains private data
     */
    privateData: true,
    /**
     * @property {function} Should return an array of <b>Object</b>s suitable
     *     to be passed to {@link Commands#commandToString}, one for each past
     *     invocation which should be restored on subsequent @dactyl
     *     startups.
     */
    serialize: null,
    /**
     * @property {number} If this command takes another ex command as an
     *     argument, the index of that argument. Used in determining whether to 
     *     purge the command from history when clearing private data.
     */
    subCommand: null,
    /**
     * @property {boolean} Specifies whether this is a user command.  User
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
            let [, head, tail] = spec.match(/([^[]+)(?:\[(.*)])?/);
            return tail ? [head + tail, head] : [head];
        });
    }
});

/**
 * @instance commands
 */
const ArgType = Struct("description", "parse");
const Commands = Module("commands", {
    init: function () {
        this._exCommands = [];
        this._exMap = {};
    },

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
    __iterator__: function () {
        let sorted = this._exCommands.sort(function (a, b) a.name > b.name);
        return util.Array.itervalues(sorted);
    },

    /** @property {string} The last executed Ex command line. */
    repeat: null,

    _addCommand: function (command, replace) {
        if (command.name in this._exMap) {
            if (command.user && replace)
                commands.removeUserCommand(command.name);
            else {
                dactyl.log("Warning: :" + command.name + " already exists, NOT replacing existing command.", 1);
                return false;
            }
        }

        this._exCommands.push(command);
        for (let [,name] in Iterator(command.names))
            this._exMap[name] = command;

        return true;
    },

    /**
     * Adds a new default command.
     *
     * @param {string[]} names The names by which this command can be
     *     invoked. The first name specified is the command's canonical
     *     name.
     * @param {string} description A description of the command.
     * @param {function} action The action invoked by this command.
     * @param {Object} extra An optional extra configuration hash.
     * @optional
     */
    add: function (names, description, action, extra) {
        return this._addCommand(Command(names, description, action, extra), false);
    },

    /**
     * Adds a new user-defined command.
     *
     * @param {string[]} names The names by which this command can be
     *     invoked. The first name specified is the command's canonical
     *     name.
     * @param {string} description A description of the command.
     * @param {function} action The action invoked by this command.
     * @param {Object} extra An optional extra configuration hash.
     * @param {boolean} replace Overwrite an existing command with the same
     *     canonical name.
     */
    addUserCommand: function (names, description, action, extra, replace) {
        extra = extra || {};
        extra.user = true;
        description = description || "User defined command";

        return this._addCommand(Command(names, description, action, extra), replace);
    },

    /**
     * Returns the specified command invocation object serialized to
     * an executable Ex command string.
     *
     * @param {Object} args The command invocation object.
     * @returns {string}
     */
    commandToString: function (args) {
        let res = [args.command + (args.bang ? "!" : "")];
        function quote(str) Commands.quoteArg[/[\s"'\\]|^$/.test(str) ? '"' : ""](str);

        for (let [opt, val] in Iterator(args.options || {})) {
            let chr = /^-.$/.test(opt) ? " " : "=";
            if (val != null)
                opt += chr + quote(val);
            res.push(opt);
        }
        for (let [, arg] in Iterator(args.arguments || []))
            res.push(quote(arg));

        let str = args.literalArg;
        if (str)
            res.push(/\n/.test(str) ? "<<EOF\n" + str.replace(/\n$/, "") + "\nEOF" : str);
        return res.join(" ");
    },

    /**
     * Returns the command with matching <b>name</b>.
     *
     * @param {string} name The name of the command to return. This can be
     *     any of the command's names.
     * @returns {Command}
     */
    get: function (name) {
        return this._exMap[name] || this._exCommands.filter(function (cmd) cmd.hasName(name))[0] || null;
    },

    /**
     * Returns the user-defined command with matching <b>name</b>.
     *
     * @param {string} name The name of the command to return. This can be
     *     any of the command's names.
     * @returns {Command}
     */
    getUserCommand: function (name) {
        return this._exCommands.filter(function (cmd) cmd.user && cmd.hasName(name))[0] || null;
    },

    /**
     * Returns all user-defined commands.
     *
     * @returns {Command[]}
     */
    getUserCommands: function () {
        return this._exCommands.filter(function (cmd) cmd.user);
    },

    _subCommands: function (command) {
        while (command) {
            // FIXME: This parseCommand/commands.get/parseArgs is duplicated too often.
            let [count, cmd, bang, args] = commands.parseCommand(command);
            command = commands.get(cmd);
            if (command) {
                try {
                    args = command.parseArgs(args, null, { count: count, bang: bang });
                    yield [command, args];
                    if (commands.subCommand == null)
                        break;
                    command = args[command.subCommand];
                }
                catch (e) {
                    break;
                }
            }
        }
    },

    /**
     * Returns true if a command invocation contains a URL referring to the 
     * domain 'host'.
     *
     * @param {string} command
     * @param {string} host
     * @returns {boolean}
     */
    hasDomain: function (command, host) {
        try {
            for (let [cmd, args] in this._subCommands(command))
                if (Array.concat(cmd.domains(args)).some(function (domain) util.isSubdomain(domain, host)))
                    return true;
        }
        catch (e) {
            dactyl.reportError(e);
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
        for (let [cmd, args] in this._subCommands(command))
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
     * Parses <b>str</b> for options and plain arguments.
     *
     * The returned <b>Args</b> object is an augmented array of arguments.
     * Any key/value pairs of <b>extra</b> will be available and the
     * following additional properties:
     *     -opt       - the value of the option -opt if specified
     *     string     - the original argument string <b>str</b>
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
    parseArgs: function (str, options, argCount, allowUnknownOptions, literal, complete, extra) {
        function getNextArg(str) {
            let [count, arg, quote] = Commands.parseArg(str);
            if (quote == "\\" && !complete)
                return [,,,"Trailing \\"];
            if (quote && !complete)
                return [,,,"E114: Missing quote: " + quote];
            return [count, arg, quote];
        }

        if (!options)
            options = [];

        if (!argCount)
            argCount = "*";

        var args = [];       // parsed options
        args.__iterator__ = function () util.Array.iteritems(this);
        args.string = str;   // for access to the unparsed string
        args.literalArg = "";

        // FIXME!
        for (let [k, v] in Iterator(extra || []))
            args[k] = v;

        var invalid = false;
        // FIXME: best way to specify these requirements?
        var onlyArgumentsRemaining = allowUnknownOptions || options.length == 0 || false; // after a -- has been found
        var arg = null;
        var count = 0; // the length of the argument
        var i = 0;
        var completeOpts;

        // XXX
        function matchOpts(arg) {
            // Push possible option matches into completions
            if (complete && !onlyArgumentsRemaining)
                completeOpts = options.filter(function (opt) opt.multiple || !(opt.names[0] in args));
        }
        function resetCompletions() {
            completeOpts = null;
            args.completeArg = null;
            args.completeOpt = null;
            args.completeFilter = null;
            args.completeStart = i;
            args.quote = Commands.complQuote[""];
        }
        if (complete) {
            resetCompletions();
            matchOpts("");
            args.completeArg = 0;
        }

        function fail(error) {
            if (complete)
                complete.message = error;
            else
                dactyl.assert(false, error);
        }

        outer:
        while (i < str.length || complete) {
            // skip whitespace
            while (/\s/.test(str[i]) && i < str.length)
                i++;
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
                            invalid = false;
                            arg = null;
                            quote = null;
                            count = 0;
                            let sep = sub[optname.length];
                            if (sep == "=" || /\s/.test(sep) && opt.type != CommandOption.NOARG) {
                                [count, arg, quote, error] = getNextArg(sub.substr(optname.length + 1));
                                dactyl.assert(!error, error);

                                // if we add the argument to an option after a space, it MUST not be empty
                                if (sep != "=" && !quote && arg.length == 0)
                                    arg = null;

                                count++; // to compensate the "=" character
                            }
                            else if (!/\s/.test(sep) && sep != undefined) // this isn't really an option as it has trailing characters, parse it as an argument
                                invalid = true;

                            if (complete && !/[\s=]/.test(sep))
                                matchOpts(sub);

                            let context = null;
                            if (!complete && quote)
                                fail("Invalid argument for option " + optname);

                            if (!invalid) {
                                if (complete && count > 0) {
                                    args.completeStart += optname.length + 1;
                                    args.completeOpt = opt;
                                    args.completeFilter = arg;
                                    args.quote = Commands.complQuote[quote] || Commands.complQuote[""];
                                }
                                if (!complete || arg != null) {
                                    let type = Commands.argTypes[opt.type];
                                    if (type) {
                                        let orig = arg;
                                        arg = type.parse(arg);
                                        if (arg == null || (typeof arg == "number" && isNaN(arg))) {
                                            if (!complete || orig != "" || args.completeStart != str.length)
                                                fail("Invalid argument for " + type.description + " option: " + optname);
                                            if (complete)
                                                complete.highlight(args.completeStart, count - 1, "SPELLCHECK");
                                        }
                                    }

                                    // we have a validator function
                                    if (typeof opt.validator == "function") {
                                        if (opt.validator.call(this, arg) == false) {
                                            fail("Invalid argument for option: " + optname);
                                            if (complete) // Always true.
                                                complete.highlight(args.completeStart, count - 1, "SPELLCHECK");
                                        }
                                    }
                                }

                                // option allowed multiple times
                                if (opt.multiple)
                                    args[opt.names[0]] = (args[opt.names[0]] || []).concat(arg);
                                else
                                    args[opt.names[0]] = opt.type == this.OPTION_NOARG || arg;

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

            if (complete) {
                if (argCount == "0" || args.length > 0  && (/[1?]/.test(argCount)))
                    complete.highlight(i, sub.length, "SPELLCHECK");
            }

            if (args.length == literal) {
                if (complete)
                    args.completeArg = args.length;
                args.literalArg = sub;
                args.push(sub);
                args.quote = null;
                break;
            }

            // if not an option, treat this token as an argument
            let [count, arg, quote, error] = getNextArg(sub);
            dactyl.assert(!error, error);

            if (complete) {
                args.quote = Commands.complQuote[quote] || Commands.complQuote[""];
                args.completeFilter = arg || "";
            }
            else if (count == -1)
                fail("Error parsing arguments: " + arg);
            else if (!onlyArgumentsRemaining && /^-/.test(arg))
                fail("Invalid option: " + arg);

            if (arg != null)
                args.push(arg);
            if (complete)
                args.completeArg = args.length - 1;

            i += count;
            if (count <= 0 || i == str.length)
                break;
        }

        if (complete) {
            if (args.completeOpt) {
                let opt = args.completeOpt;
                let context = complete.fork(opt.names[0], args.completeStart);
                context.filter = args.completeFilter;
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

        // check for correct number of arguments
        if (args.length == 0 && /^[1+]$/.test(argCount) ||
                literal != null && /[1+]/.test(argCount) && !/\S/.test(args.literalArg || "")) {
            if (!complete)
                fail("E471: Argument required");
        }
        else if (args.length == 1 && (argCount == "0") ||
                 args.length > 1  && /^[01?]$/.test(argCount))
            fail("E488: Trailing characters");

        return args;
    },

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

        // 0 - count, 1 - cmd, 2 - special, 3 - args
        let matches = str.match(/^[:\s]*(\d+|%)?([a-zA-Z]+|!)(!)?(?:\s*(.*?))?$/);
        //var matches = str.match(/^:*(\d+|%)?([a-zA-Z]+|!)(!)?(?:\s*(.*?)\s*)?$/);
        if (!matches)
            return [null, null, null, null];

        let [, count, cmd, special, args] = matches;

        // parse count
        if (count)
            count = count == "%" ? this.COUNT_ALL : parseInt(count, 10);
        else
            count = this.COUNT_NONE;

        return [count, cmd, !!special, args || ""];
    },

    /** @property */
    get complQuote() Commands.complQuote,

    /** @property */
    get quoteArg() Commands.quoteArg, // XXX: better somewhere else?

    /**
     * Remove the user-defined command with matching <b>name</b>.
     *
     * @param {string} name The name of the command to remove. This can be
     *     any of the command's names.
     */
    removeUserCommand: function (name) {
        for (let [,cmd] in Iterator(this._exCommands))
                if (cmd.user && cmd.hasName(name))
                    for (let [,name] in Iterator(cmd.names))
                        delete this._exMap[name];
        this._exCommands = this._exCommands.filter(function (cmd) !(cmd.user && cmd.hasName(name)));
    },

    // FIXME: still belong here? Also used for autocommand parameters.
    /**
     * Returns a string with all tokens in <b>string</b> matching "<key>"
     * replaced with "value". Where "key" is a property of the specified
     * <b>tokens</b> object and "value" is the corresponding value. The
     * <lt> token can be used to include a literal "<" in the returned
     * string. Any tokens prefixed with "q-" will be quoted except for
     * <q-lt> which is treated like <lt>.
     *
     * @param {string} str The string with tokens to replace.
     * @param {Object} tokens A map object whose keys are replaced with its
     *     values.
     * @returns {string}
     */
    replaceTokens: function replaceTokens(str, tokens) {
        return str.replace(/<((?:q-)?)([a-zA-Z]+)?>/g, function (match, quote, token) {
            if (token == "lt") // Don't quote, as in Vim (but, why so in Vim? You'd think people wouldn't say <q-lt> if they didn't want it)
                return "<";
            let res = tokens[token];
            if (res == undefined) // Ignore anything undefined
                res = "<" + token + ">";
            if (quote && typeof res != "number")
                return Commands.quoteArg['"'](res);
            return res;
        });
    }
}, {
    QUOTE_STYLE: "rc-ish",

    // returns [count, parsed_argument]
    parseArg: function (str) {
        let arg = "";
        let quote = null;
        let len = str.length;

        while (str.length && !/^\s/.test(str)) {
            let res;
            if ((res = str.match = str.match(/^()((?:[^\\\s"']|\\.)+)((?:\\$)?)/)))
                arg += res[2].replace(/\\(.)/g, "$1");
            else if ((res = str.match(/^(")((?:[^\\"]|\\.)*)("?)/)))
                arg += eval(res[0] + (res[3] ? "" : '"'));
            else if ((res = str.match(/^(')((?:[^']|'')*)('?)/)))
                arg += res[2].replace("''", "'", "g");
            else
                break;

            if (!res[3])
                quote = res[1];
            if (!res[1])
                quote = res[3];
            str = str.substr(res[0].length);
        }

        return [len - str.length, arg, quote];
    }
}, {
    completion: function () {
        completion.command = function command(context) {
            context.title = ["Command"];
            context.keys = { text: "longNames", description: "description" };
            context.completions = [k for (k in commands)];
        };

        // provides completions for ex commands, including their arguments
        completion.ex = function ex(context) {
            // if there is no space between the command name and the cursor
            // then get completions of the command name
            let [count, cmd, bang, args] = commands.parseCommand(context.filter);
            let [, prefix, junk] = context.filter.match(/^(:*\d*)\w*(.?)/) || [];
            context.advance(prefix.length);
            if (!junk) {
                context.fork("", 0, this, "command");
                return;
            }

            // dynamically get completions as specified with the command's completer function
            let command = commands.get(cmd);
            if (!command) {
                context.highlight(0, cmd.length, "SPELLCHECK");
                return;
            }

            [prefix] = context.filter.match(/^(?:\w*[\s!]|!)\s*/);
            let cmdContext = context.fork(command.name, prefix.length);
            let argContext = context.fork("args", prefix.length);
            args = command.parseArgs(cmdContext.filter, argContext, { count: count, bang: bang });
            if (args && !cmdContext.waitingForTab) {
                // FIXME: Move to parseCommand
                args.count = count;
                args.bang = bang;
                if (!args.completeOpt && command.completer) {
                    cmdContext.advance(args.completeStart);
                    cmdContext.quote = args.quote;
                    cmdContext.filter = args.completeFilter;
                    try {
                        let compObject = command.completer.call(command, cmdContext, args);
                        if (compObject instanceof Array) // for now at least, let completion functions return arrays instead of objects
                            compObject = { start: compObject[0], items: compObject[1] };
                        if (compObject != null) {
                            cmdContext.advance(compObject.start);
                            cmdContext.filterFunc = null;
                            cmdContext.completions = compObject.items;
                        }
                    }
                    catch (e) {
                        dactyl.reportError(e);
                    }
                }
            }
        };

        completion.userCommand = function userCommand(context) {
            context.title = ["User Command", "Definition"];
            context.keys = { text: "name", description: "replacementText" };
            context.completions = commands.getUserCommands();
        };
    },

    commands: function () {
        function userCommand(args, modifiers) {
            let tokens = {
                args:  this.argCount && args.string,
                bang:  this.bang && args.bang ? "!" : "",
                count: this.count && args.count
            };

            dactyl.execute(commands.replaceTokens(this.replacementText, tokens));
        }

        // TODO: offer completion.ex?
        //     : make this config specific
        var completeOptionMap = {
            abbreviation: "abbreviation", altstyle: "alternateStyleSheet",
            bookmark: "bookmark", buffer: "buffer", color: "colorScheme",
            command: "command", dialog: "dialog", dir: "directory",
            environment: "environment", event: "autocmdEvent", file: "file",
            help: "help", highlight: "highlightGroup", javascript: "javascript",
            macro: "macro", mapping: "userMapping", menu: "menuItem",
            option: "option", preference: "preference", search: "search",
            shellcmd: "shellCommand", sidebar: "sidebar", url: "url",
            usercommand: "userCommand"
        };

        // TODO: Vim allows commands to be defined without {rep} if there are {attr}s
        // specified - useful?
        commands.add(["com[mand]"],
            "List and define commands",
            function (args) {
                let cmd = args[0];

                dactyl.assert(!/\W/.test(cmd || ''), "E182: Invalid command name");

                if (args.literalArg) {
                    let nargsOpt       = args["-nargs"] || "0";
                    let bangOpt        = "-bang"  in args;
                    let countOpt       = "-count" in args;
                    let descriptionOpt = args["-description"] || "User-defined command";
                    let completeOpt    = args["-complete"];

                    let completeFunc = null; // default to no completion for user commands

                    if (completeOpt) {
                        if (/^custom,/.test(completeOpt)) {
                            completeOpt = completeOpt.substr(7);
                            completeFunc = function () {
                                try {
                                    var completer = dactyl.usereval(completeOpt);

                                    if (!callable(completer))
                                        throw new TypeError("User-defined custom completer " + completeOpt.quote() + " is not a function");
                                }
                                catch (e) {
                                    dactyl.echo(":" + this.name + " ...");
                                    dactyl.echoerr("E117: Unknown function: " + completeOpt);
                                    dactyl.log(e);
                                    return undefined;
                                }
                                return completer.apply(this, Array.slice(arguments));
                            };
                        }
                        else
                            completeFunc = completion[completeOptionMap[completeOpt]];
                    }

                    let added = commands.addUserCommand([cmd],
                                    descriptionOpt,
                                    userCommand, {
                                        argCount: nargsOpt,
                                        bang: bangOpt,
                                        count: countOpt,
                                        completer: completeFunc,
                                        replacementText: args.literalArg
                                    }, args.bang);

                    if (!added)
                        dactyl.echoerr("E174: Command already exists: add ! to replace it");
                }
                else {
                    function completerToString(completer) {
                        if (completer)
                            return [k for ([k, v] in Iterator(completeOptionMap)) if (completer == completion[v])][0] || "custom";
                        else
                            return "";
                    }

                    // TODO: using an array comprehension here generates flakey results across repeated calls
                    //     : perhaps we shouldn't allow options in a list call but just ignore them for now
                    //     : No, array comprehensions are fine, generator statements aren't. --Kris
                    let cmds = this._exCommands.filter(function (c) c.user && (!cmd || c.name.match("^" + cmd)));

                    if (cmds.length > 0)
                        commandline.commandOutput(
                            template.tabular(["", "Name", "Args", "Range", "Complete", "Definition"], ["padding-right: 2em;"]),
                                ([cmd.bang ? "!" : " ",
                                  cmd.name,
                                  cmd.argCount,
                                  cmd.count ? "0c" : "",
                                  completerToString(cmd.completer),
                                  cmd.replacementText || "function () { ... }"]
                                 for ([, cmd] in Iterator(cmds))));
                    else
                        dactyl.echomsg("No user-defined commands found");
                }
            }, {
                bang: true,
                completer: function (context, args) {
                    if (args.completeArg == 0)
                        completion.userCommand(context);
                    else
                        completion.ex(context);
                },
                options: [
                    { names: ["-bang"],  description: "Command may be proceeded by a !" },
                    { names: ["-count"], description: "Command may be preceeded by a count" },
                    { 
                        names: ["-description"], 
                        description: "A user-visible description of the command",
                        type: CommandOption.STRING
                    }, { 
                        // TODO: "E180: invalid complete value: " + arg
                        names: ["-complete"], 
                        description: "The argument completion function",
                        completer: function (context) [[k, ""] for ([k, v] in Iterator(completeOptionMap))],
                        type: CommandOption.STRING,
                        validator: function (arg) arg in completeOptionMap || /custom,\w+/.test(arg),
                    }, {
                        names: ["-nargs"],
                        description: "The allowed number of arguments",
                        completer: [["0", "No arguments are allowed (default)"],
                                    ["1", "One argument is allowed"],
                                    ["*", "Zero or more arguments are allowed"],
                                    ["?", "Zero or one argument is allowed"],
                                    ["+", "One or more arguments are allowed"]],
                        type: CommandOption.STRING,
                        validator: function (arg) /^[01*?+]$/.test(arg)
                    },
                ],
                literal: 1,
                serialize: function () [ {
                        command: this.name,
                        bang: true,
                        options: util.Array.toObject(
                            [[v, typeof cmd[k] == "boolean" ? null : cmd[k]]
                             // FIXME: this map is expressed multiple times
                             for ([k, v] in Iterator({ argCount: "-nargs", bang: "-bang", count: "-count", description: "-description" }))
                             // FIXME: add support for default values to parseArgs
                             if (k in cmd && cmd[k] != "0" && cmd[k] != "User-defined command")]),
                        arguments: [cmd.name],
                        literalArg: cmd.replacementText
                    }
                    for ([k, cmd] in Iterator(commands._exCommands))
                    if (cmd.user && cmd.replacementText)
                ]
            });

        commands.add(["comc[lear]"],
            "Delete all user-defined commands",
            function () {
                commands.getUserCommands().forEach(function (cmd) { commands.removeUserCommand(cmd.name); });
            },
            { argCount: "0" });

        commands.add(["delc[ommand]"],
            "Delete the specified user-defined command",
            function (args) {
                let name = args[0];

                if (commands.get(name))
                    commands.removeUserCommand(name);
                else
                    dactyl.echoerr("E184: No such user-defined command: " + name);
            }, {
                argCount: "1",
                completer: function (context) completion.userCommand(context)
            });
    },
    javascript: function () {
        JavaScript.setCompleter(this.get, [function () ([c.name, c.description] for (c in commands))]);
    },
    mappings: function () {
        mappings.add(config.browserModes,
            ["@:"], "Repeat the last Ex command",
            function (count) {
                if (commands.repeat) {
                    for (let i in util.interruptibleRange(0, Math.max(count, 1), 100))
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
        "\n": "n",
        "\t": "t"
    };
    function quote(q, list) {
        let re = RegExp("[" + list + "]", "g");
        return function (str) q + String.replace(str, re, function ($0) $0 in Commands.quoteMap ? Commands.quoteMap[$0] : ("\\" + $0)) + q;
    };
    Commands.complQuote = { // FIXME
        '"': ['"', quote("", '\n\t"\\\\'), '"'],
        "'": ["'", quote("", "\\\\'"), "'"],
        "":  ["", quote("",  "\\\\ "), ""]
    };
    Commands.quoteArg = {
        '"': quote('"', '\n\t"\\\\'),
        "'": quote("'", "\\\\'"),
        "":  quote("",  "\\\\ ")
    };

    Commands.parseBool = function (arg) {
        if (/^(true|1|on)$/i.test(arg))
            return true;
        if (/^(false|0|off)$/i.test(arg))
            return false;
        return NaN;
    };
    Commands.argTypes = [
        null,
        ArgType("no arg",  function (arg) !arg || null),
        ArgType("boolean", Commands.parseBool),
        ArgType("string",  function (val) val),
        ArgType("int",     parseInt),
        ArgType("float",   parseFloat),
        ArgType("list",    function (arg) arg && arg.split(/\s*,\s*/))
    ];
})();

// vim: set fdm=marker sw=4 ts=4 et:
