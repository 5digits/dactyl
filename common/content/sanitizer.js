// Copyright (c) 2009 by Doug Kearns <dougkearns@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

// TODO:
//   - fix Sanitize autocommand
//   - add warning for TIMESPAN_EVERYTHING?
//   - respect privacy.clearOnShutdown et al or recommend Leave autocommand?
//   - add support for :set sanitizeitems=all like 'eventignore'?
//   - integrate with the Clear Private Data dialog?

// FIXME:
//   - finish 1.9.0 support if we're going to support sanitizing in Xulmus

const Sanitizer = Module("sanitizer", {
    init: function () {
        const self = this;
        dactyl.loadScript("chrome://browser/content/sanitize.js", Sanitizer);
        Sanitizer.getClearRange = Sanitizer.Sanitizer.getClearRange;
        this.__proto__.__proto__ = new Sanitizer.Sanitizer; // Good enough.

        // TODO: remove this version test
        if (/^1.9.1/.test(services.get("xulAppInfo").platformVersion))
            self.prefDomain = "privacy.cpd.";
        else
            self.prefDomain = "privacy.item.";

        self.prefDomain2 = "extensions.dactyl.privacy.cpd.";
    },

    // Largely ripped from from browser/base/content/sanitize.js so we can override
    // the pref strategy without stepping on the global prefs namespace.
    sanitize: function () {
        const prefService = services.get("pref");
        let branch = prefService.getBranch(this.prefDomain);
        let branch2 = prefService.getBranch(this.prefDomain2);
        let errors = null;

        function prefSet(name) {
            try {
                return branch.getBoolPref(name);
            }
            catch (e) {
                return branch2.getBoolPref(name);
            }
        }

        // Cache the range of times to clear
        if (this.ignoreTimespan)
            var range = null;  // If we ignore timespan, clear everything
        else
            range = this.range || Sanitizer.getClearRange();

        for (let itemName in this.items) {
            let item = this.items[itemName];
            item.range = range;

            if ("clear" in item && item.canClear && prefSet(itemName)) {
                dactyl.log("Sanitizing " + itemName + " items...");
                // Some of these clear() may raise exceptions (see bug #265028)
                // to sanitize as much as possible, we catch and store them,
                // rather than fail fast.
                // Callers should check returned errors and give user feedback
                // about items that could not be sanitized
                try {
                    item.clear();
                }
                catch (e) {
                    if (!errors)
                        errors = {};
                    errors[itemName] = e;
                    dump("Error sanitizing " + itemName + ": " + e + "\n");
                }
            }
        }

        return errors;
    },

    get prefNames() util.Array.flatten([this.prefDomain, this.prefDomain2].map(options.allPrefs))
}, {
    prefArgList: [["commandLine",  "commandline"],
                  ["offlineApps",  "offlineapps"],
                  ["siteSettings", "sitesettings"]],
    prefToArg: function (pref) {
        pref = pref.replace(/.*\./, "");
        return util.Array.toObject(Sanitizer.prefArgList)[pref] || pref;
    },

    argToPref: function (arg) [k for ([k, v] in values(Sanitizer.prefArgList)) if (v == arg)][0] || arg
}, {
    commands: function () {
        commands.add(["sa[nitize]"],
            "Clear private data",
            function (args) {
                dactyl.assert(!options['private'], "Cannot sanitize items in private mode");

                let timespan = args["-timespan"] || options["sanitizetimespan"];

                sanitizer.range = Sanitizer.getClearRange(timespan);
                sanitizer.ignoreTimespan = !sanitizer.range;

                if (args.bang) {
                    dactyl.assert(args.length == 0, "E488: Trailing characters");

                    dactyl.log("Sanitizing all items in 'sanitizeitems'...");

                    let errors = sanitizer.sanitize();

                    if (errors) {
                        for (let item in errors)
                            dactyl.echoerr("Error sanitizing " + item + ": " + errors[item]);
                    }
                }
                else {
                    dactyl.assert(args.length > 0, "E471: Argument required");

                    for (let [, item] in Iterator(args.map(Sanitizer.argToPref))) {
                        dactyl.log("Sanitizing " + item + " items...");

                        if (sanitizer.canClearItem(item)) {
                            try {
                                sanitizer.items[item].range = sanitizer.range;
                                sanitizer.clearItem(item);
                            }
                            catch (e) {
                                dactyl.echoerr("Error sanitizing " + item + ": " + e);
                            }
                        }
                        else
                            dactyl.echomsg("Cannot sanitize " + item);
                    }
                }
            },
            {
                argCount: "*", // FIXME: should be + and 0
                bang: true,
                completer: function (context) {
                    context.title = ["Privacy Item", "Description"];
                    context.completions = options.get("sanitizeitems").completer();
                },
                options: [
                    {
                        names: ["-timespan", "-t"],
                        description: "Timespan for which to sanitize items",
                        completer: function () options.get("sanitizetimespan").completer(),
                        type: CommandOption.INT,
                        validator: function (arg) /^[0-4]$/.test(arg)
                    }
                 ]
            });
    },
    options: function () {
        const self = this;

        // add dactyl-specific private items
        [
            {
                name: "commandLine",
                action: function () {
                    let stores = ["command", "search"];

                    if (self.range) {
                        stores.forEach(function (store) {
                            storage["history-" + store].mutate("filter", function (item) {
                                let timestamp = item.timestamp * 1000;
                                return timestamp < self.range[0] || timestamp > self.range[1];
                            });
                        });
                    }
                    else
                        stores.forEach(function (store) { storage["history-" + store].truncate(0); });
                }
            },
            {
                name: "macros",
                action: function () { storage["macros"].clear(); }
            },
            {
                name: "marks",
                action: function () {
                    storage["local-marks"].clear();
                    storage["url-marks"].clear();
                }
            }
        ].forEach(function (item) {
            let pref = self.prefDomain2 + item.name;

            if (options.getPref(pref) == null)
                options.setPref(pref, false);

            self.items[item.name] = {
                canClear: true,
                clear: item.action
            };
        });

        // call Sanitize autocommand
        for (let [name, item] in Iterator(self.items)) {
            let arg = Sanitizer.prefToArg(name);

            if (item.clear) {
                let func = item.clear;
                item.clear = function () {
                    autocommands.trigger("Sanitize", { name: arg });
                    func.call(item);
                };
            }
        }

        options.add(["sanitizeitems", "si"],
            "The default list of private items to sanitize",
            "stringlist", "cache,commandline,cookies,formdata,history,marks,sessions",
            {
                setter: function (values) {
                    for (let [, pref] in Iterator(sanitizer.prefNames)) {
                        options.setPref(pref, false);

                        for (let [, value] in Iterator(values)) {
                            if (Sanitizer.prefToArg(pref) == value) {
                                options.setPref(pref, true);
                                break;
                            }
                        }
                    }

                    return values;
                },
                getter: function () sanitizer.prefNames.filter(function (pref) options.getPref(pref)).map(Sanitizer.prefToArg),
                completer: function (value) [
                    ["cache", "Cache"],
                    ["commandline", "Command-line history"],
                    ["cookies", "Cookies"],
                    ["downloads", "Download history"],
                    ["formdata", "Saved form and search history"],
                    ["history", "Browsing history"],
                    ["macros", "Saved macros"],
                    ["marks", "Local and URL marks"],
                    ["offlineapps", "Offline website data"],
                    ["passwords", "Saved passwords"],
                    ["sessions", "Authenticated sessions"],
                    ["sitesettings", "Site preferences"]
                ]
            });

        options.add(["sanitizetimespan", "sts"],
            "The default sanitizer time span",
            "number", 1,
            {
                setter: function (value) {
                    options.setPref("privacy.sanitize.timeSpan", value);
                    return value;
                },
                getter: function () options.getPref("privacy.sanitize.timeSpan", this.defaultValue),
                completer: function (value) [
                    ["0", "Everything"],
                    ["1", "Last hour"],
                    ["2", "Last two hours"],
                    ["3", "Last four hours"],
                    ["4", "Today"]
                ]
            });
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
