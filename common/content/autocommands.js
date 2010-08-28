// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2009 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

const AutoCommand = Struct("event", "pattern", "command");

/**
 * @instance autocommands
 */
const AutoCommands = Module("autocommands", {
    requires: ["config"],

    init: function () {
        this._store = [];
    },

    __iterator__: function () util.Array.itervalues(this._store),

    /**
     * Adds a new autocommand. <b>cmd</b> will be executed when one of the
     * specified <b>events</b> occurs and the URL of the applicable buffer
     * matches <b>regex</b>.
     *
     * @param {Array} events The array of event names for which this
     *     autocommand should be executed.
     * @param {string} regex The URL pattern to match against the buffer URL.
     * @param {string} cmd The Ex command to run.
     */
    add: function (events, regex, cmd) {
        if (typeof events == "string") {
            events = events.split(",");
            dactyl.log("DEPRECATED: the events list arg to autocommands.add() should be an array of event names");
        }
        events.forEach(function (event) {
            this._store.push(AutoCommand(event, RegExp(regex), cmd));
        }, this);
    },

    /**
     * Returns all autocommands with a matching <b>event</b> and
     * <b>regex</b>.
     *
     * @param {string} event The event name filter.
     * @param {string} regex The URL pattern filter.
     * @returns {AutoCommand[]}
     */
    get: function (event, regex) {
        return this._store.filter(function (autoCmd) AutoCommands.matchAutoCmd(autoCmd, event, regex));
    },

    /**
     * Deletes all autocommands with a matching <b>event</b> and
     * <b>regex</b>.
     *
     * @param {string} event The event name filter.
     * @param {string} regex The URL pattern filter.
     */
    remove: function (event, regex) {
        this._store = this._store.filter(function (autoCmd) !AutoCommands.matchAutoCmd(autoCmd, event, regex));
    },

    /**
     * Lists all autocommands with a matching <b>event</b> and
     * <b>regex</b>.
     *
     * @param {string} event The event name filter.
     * @param {string} regex The URL pattern filter.
     */
    list: function (event, regex) {
        let cmds = {};

        // XXX
        this._store.forEach(function (autoCmd) {
            if (AutoCommands.matchAutoCmd(autoCmd, event, regex)) {
                cmds[autoCmd.event] = cmds[autoCmd.event] || [];
                cmds[autoCmd.event].push(autoCmd);
            }
        });

        let list = template.commandOutput(
            <table>
                <tr highlight="Title">
                    <td colspan="2">----- Auto Commands -----</td>
                </tr>
                {
                    template.map(cmds, function ([event, items])
                    <tr highlight="Title">
                        <td colspan="2">{event}</td>
                    </tr>
                    +
                        template.map(items, function (item)
                        <tr>
                            <td>&#160;{item.pattern.source}</td>
                            <td>{item.command}</td>
                        </tr>))
                }
            </table>);

        commandline.echo(list, commandline.HL_NORMAL, commandline.FORCE_MULTILINE);
    },

    /**
     * Triggers the execution of all autocommands registered for
     * <b>event</b>. A map of <b>args</b> is passed to each autocommand
     * when it is being executed.
     *
     * @param {string} event The event to fire.
     * @param {Object} args The args to pass to each autocommand.
     */
    trigger: function (event, args) {
        if (options.get("eventignore").has("all", event))
            return;

        let autoCmds = this._store.filter(function (autoCmd) autoCmd.event == event);

        dactyl.echomsg("Executing " + event + " Auto commands for \"*\"", 8);

        let lastPattern = null;
        let url = args.url || "";

        for (let [, autoCmd] in Iterator(autoCmds)) {
            if (autoCmd.pattern.test(url)) {
                if (!lastPattern || lastPattern.source != autoCmd.pattern.source)
                    dactyl.echomsg("Executing " + event + " Auto commands for \"" + autoCmd.pattern.source + "\"", 8);

                lastPattern = autoCmd.pattern;
                dactyl.echomsg("autocommand " + autoCmd.command, 9);

                if (typeof autoCmd.command == "function") {
                    try {
                        autoCmd.command.call(autoCmd, args);
                    }
                    catch (e) {
                        dactyl.reportError(e);
                        dactyl.echoerr(e);
                    }
                }
                else
                    dactyl.execute(commands.replaceTokens(autoCmd.command, args), null, true);
            }
        }
    }
}, {
    matchAutoCmd: function (autoCmd, event, regex) {
        return (!event || autoCmd.event == event) && (!regex || autoCmd.pattern.source == regex);
    }
}, {
    commands: function () {
        commands.add(["au[tocmd]"],
            "Execute commands automatically on events",
            function (args) {
                let [event, regex, cmd] = args;
                let events = [];

                try {
                    RegExp(regex);
                }
                catch (e) {
                    dactyl.assert(false, "E475: Invalid argument: " + regex);
                }

                if (event) {
                    // NOTE: event can only be a comma separated list for |:au {event} {pat} {cmd}|
                    let validEvents = config.autocommands.map(function (event) event[0]);
                    validEvents.push("*");

                    events = event.split(",");
                    dactyl.assert(events.every(function (event) validEvents.indexOf(event) >= 0),
                        "E216: No such group or event: " + event);
                }

                if (cmd) { // add new command, possibly removing all others with the same event/pattern
                    if (args.bang)
                        autocommands.remove(event, regex);
                    if (args["-javascript"])
                        cmd = eval("(function (args) { with(args) {" + cmd + "} })");
                    autocommands.add(events, regex, cmd);
                }
                else {
                    if (event == "*")
                        event = null;

                    if (args.bang) {
                        // TODO: "*" only appears to work in Vim when there is a {group} specified
                        if (args[0] != "*" || regex)
                            autocommands.remove(event, regex); // remove all
                    }
                    else
                        autocommands.list(event, regex);   // list all
                }
            }, {
                bang: true,
                completer: function (context, args) {
                    if (args.length == 1)
                        return completion.autocmdEvent(context);
                    if (args.length == 3)
                        return args["-javascript"] ? completion.javascript(context) : completion.ex(context);
                },
                literal: 2,
                options: [[["-javascript", "-js"], commands.OPTION_NOARG]]
            });

        [
            {
                name: "do[autocmd]",
                description: "Apply the autocommands matching the specified URL pattern to the current buffer"
            }, {
                name: "doautoa[ll]",
                description: "Apply the autocommands matching the specified URL pattern to all buffers"
            }
        ].forEach(function (command) {
            commands.add([command.name],
                command.description,
                // TODO: Perhaps this should take -args to pass to the command?
                function (args) {
                    // Vim compatible
                    if (args.length == 0) {
                        dactyl.echomsg("No matching autocommands");
                        return;
                    }

                    let [event, url] = args;
                    let defaultURL = url || buffer.URL;
                    let validEvents = config.autocommands.map(function (e) e[0]);

                    // TODO: add command validators
                    dactyl.assert(event != "*",
                        "E217: Can't execute autocommands for ALL events");
                    dactyl.assert(validEvents.indexOf(event) >= 0,
                        "E216: No such group or event: " + args);
                    dactyl.assert(autocommands.get(event).some(function (c) c.pattern.test(defaultURL)),
                        "No matching autocommands");

                    if (this.name == "doautoall" && dactyl.has("tabs")) {
                        let current = tabs.index();

                        for (let i = 0; i < tabs.count; i++) {
                            tabs.select(i);
                            // if no url arg is specified use the current buffer's URL
                            autocommands.trigger(event, { url: url || buffer.URL });
                        }

                        tabs.select(current);
                    }
                    else
                        autocommands.trigger(event, { url: defaultURL });
                }, {
                    argCount: "*", // FIXME: kludged for proper error message should be "1".
                    completer: function (context) completion.autocmdEvent(context)
                });
        });
    },
    completion: function () {
        JavaScript.setCompleter(this.get, [function () config.autocommands]);

        completion.autocmdEvent = function autocmdEvent(context) {
            context.completions = config.autocommands;
        };

        completion.macro = function macro(context) {
            context.title = ["Macro", "Keys"];
            context.completions = [item for (item in events.getMacros())];
        };
    },
    options: function () {
        options.add(["eventignore", "ei"],
            "List of autocommand event names which should be ignored",
            "stringlist", "",
            {
                completer: function () config.autocommands.concat([["all", "All events"]])
            });

        options.add(["strictfocus", "sf"],
            "Prevent scripts from focusing input elements without user intervention",
            "boolean", true);
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
