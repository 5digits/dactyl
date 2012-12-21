// Copyright (c) 2009-2012 Kris Maglione <maglione.k@gmail.com>
// Copyright (c) 2009-2010 by Doug Kearns <dougkearns@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

defineModule("addons", {
    exports: ["AddonManager", "Addons", "Addon", "addons"],
    require: ["services", "util"]
});

this.lazyRequire("completion", ["completion"]);
lazyRequire("template", ["template"]);

var callResult = function callResult(method) {
    let args = Array.slice(arguments, 1);
    return function (result) { result[method].apply(result, args); };
}

var listener = function listener(action, event)
    function addonListener(install) {
        this.dactyl[install.error ? "echoerr" : "echomsg"](
            _("addon.error", action, event, (install.name || install.sourceURI.spec) +
                (install.error ? ": " + addons.errors[install.error] : "")));
    }

var AddonListener = Class("AddonListener", {
    init: function init(modules) {
        this.dactyl = modules.dactyl;
    },

    onNewInstall:        function (install) {},
    onExternalInstall:   function (addon, existingAddon, needsRestart) {},
    onDownloadStarted:   listener("download", "started"),
    onDownloadEnded:     listener("download", "complete"),
    onDownloadCancelled: listener("download", "canceled"),
    onDownloadFailed:    listener("download", "failed"),
    onDownloadProgress:  function (install) {},
    onInstallStarted:    function (install) {},
    onInstallEnded:      listener("installation", "complete"),
    onInstallCancelled:  listener("installation", "canceled"),
    onInstallFailed:     listener("installation", "failed")
});

var updateAddons = Class("UpgradeListener", AddonListener, {
    init: function init(addons, modules) {
        init.supercall(this, modules);

        util.assert(!addons.length || addons[0].findUpdates,
                    _("error.unavailable", config.host, services.runtime.version));

        this.remaining = addons;
        this.upgrade = [];
        this.dactyl.echomsg(_("addon.check", addons.map(function (a) a.name).join(", ")));
        for (let addon in values(addons))
            addon.findUpdates(this, AddonManager.UPDATE_WHEN_USER_REQUESTED, null, null);

    },
    onUpdateAvailable: function (addon, install) {
        this.upgrade.push(addon);
        install.addListener(this);
        install.install();
    },
    onUpdateFinished: function (addon, error) {
        this.remaining = this.remaining.filter(function (a) a.type != addon.type || a.id != addon.id);
        if (!this.remaining.length)
            this.dactyl.echomsg(
                this.upgrade.length
                    ? _("addon.installingUpdates", this.upgrade.map(function (i) i.name).join(", "))
                    : _("addon.noUpdates"));
    }
});

var actions = {
    delete: {
        name: ["extde[lete]", "extrm"],
        description: "Uninstall an extension",
        action: callResult("uninstall"),
        perm: "uninstall"
    },
    enable: {
        name: "exte[nable]",
        description: "Enable an extension",
        action: function (addon) { addon.userDisabled = false; },
        filter: function (addon) addon.userDisabled,
        perm: "enable"
    },
    disable: {
        name: "extd[isable]",
        description: "Disable an extension",
        action: function (addon) { addon.userDisabled = true; },
        filter: function (addon) !addon.userDisabled,
        perm: "disable"
    },
    options: {
        name: ["exto[ptions]", "extp[references]"],
        description: "Open an extension's preference dialog",
        bang: true,
        action: function (addon, bang) {
            if (bang)
                this.window.openDialog(addon.optionsURL, "_blank", "chrome");
            else
                this.dactyl.open(addon.optionsURL, { from: "extoptions" });
        },
        filter: function (addon) addon.isActive && addon.optionsURL
    },
    rehash: {
        name: "extr[ehash]",
        description: "Reload an extension",
        action: function (addon) {
            util.assert(config.haveGecko("2b"), _("command.notUseful", config.host));
            util.flushCache();
            util.timeout(function () {
                addon.userDisabled = true;
                addon.userDisabled = false;
            });
        },
        get filter() {
            return function (addon) !addon.userDisabled &&
                !(addon.operationsRequiringRestart & (AddonManager.OP_NEEDS_RESTART_ENABLE | AddonManager.OP_NEEDS_RESTART_DISABLE))
        },
        perm: "disable"
    },
    toggle: {
        name: "extt[oggle]",
        description: "Toggle an extension's enabled status",
        action: function (addon) { addon.userDisabled = !addon.userDisabled; }
    },
    update: {
        name: "extu[pdate]",
        description: "Update an extension",
        actions: updateAddons,
        perm: "upgrade"
    }
};

var Addon = Class("Addon", {
    init: function init(addon, list) {
        this.addon = addon;
        this.instance = this;
        this.list = list;

        this.nodes = {
            commandTarget: this
        };
        DOM.fromJSON(
            ["tr", { highlight: "Addon", key: "row" },
                ["td", { highlight: "AddonName", key: "name" }],
                ["td", { highlight: "AddonVersion", key: "version" }],
                ["td", { highlight: "AddonButtons Buttons" },
                    ["a", { highlight: "Button", href: "javascript:0", key: "enable" }, _("addon.action.On")],
                    ["a", { highlight: "Button", href: "javascript:0", key: "disable" }, _("addon.action.Off")],
                    ["a", { highlight: "Button", href: "javascript:0", key: "delete" }, _("addon.action.Delete")],
                    ["a", { highlight: "Button", href: "javascript:0", key: "update" }, _("addon.action.Update")],
                    ["a", { highlight: "Button", href: "javascript:0", key: "options" }, _("addon.action.Options")]],
                ["td", { highlight: "AddonStatus", key: "status" }],
                ["td", { highlight: "AddonDescription", key: "description" }]],
            this.list.document, this.nodes);

        this.update();
    },

    commandAllowed: function commandAllowed(cmd) {
        util.assert(Set.has(actions, cmd), _("addon.unknownCommand"));

        let action = actions[cmd];
        if ("perm" in action && !(this.permissions & AddonManager["PERM_CAN_" + action.perm.toUpperCase()]))
            return false;
        if ("filter" in action && !action.filter(this))
            return false;
        return true;
    },

    command: function command(cmd) {
        util.assert(this.commandAllowed(cmd), _("addon.commandNotAllowed"));

        let action = actions[cmd];
        if (action.action)
            action.action.call(this.list.modules, this, true);
        else
            action.actions([this], this.list.modules);
    },

    compare: function compare(other) String.localeCompare(this.name, other.name),

    get statusInfo() {
        let info = this.isActive ? ["span", { highlight: "Enabled" }, "enabled"]
                                 : ["span", { highlight: "Disabled" }, "disabled"];

        let pending;
        if (this.pendingOperations & AddonManager.PENDING_UNINSTALL)
            pending = ["Disabled", "uninstalled"];
        else if (this.pendingOperations & AddonManager.PENDING_DISABLE)
            pending = ["Disabled", "disabled"];
        else if (this.pendingOperations & AddonManager.PENDING_INSTALL)
            pending = ["Enabled", "installed"];
        else if (this.pendingOperations & AddonManager.PENDING_ENABLE)
            pending = ["Enabled", "enabled"];
        else if (this.pendingOperations & AddonManager.PENDING_UPGRADE)
            pending = ["Enabled", "upgraded"];
        if (pending)
            return [info, " (",
                    ["span", { highlight: pending[0] }, pending[1]],
                    " on ",
                    ["a", { href: "#", "dactyl:command": "dactyl.restart" }, "restart"],
                    ")"]
        return info;
    },

    update: function callee() {
        let self = this;
        function update(key, xml) {
            let node = self.nodes[key];
            while (node.firstChild)
                node.removeChild(node.firstChild);

            DOM(node).append(isArray(xml) ? xml : DOM.DOMString(xml));
        }

        update("name", template.icon({ icon: this.iconURL }, this.name));
        this.nodes.version.textContent = this.version;
        update("status", this.statusInfo);
        this.nodes.description.textContent = this.description;
        DOM(this.nodes.row).attr("active", this.isActive || null);

        for (let node in values(this.nodes))
            if (node.update && node.update !== callee)
                node.update();

        let event = this.list.document.createEvent("Events");
        event.initEvent("dactyl-commandupdate", true, false);
        this.list.document.dispatchEvent(event);
    }
});

["cancelUninstall", "findUpdates", "getResourceURI", "hasResource", "isCompatibleWith",
 "uninstall"].forEach(function (prop) {
     Addon.prototype[prop] = function proxy() this.addon[prop].apply(this.addon, arguments);
});

["aboutURL", "appDisabled", "applyBackgroundUpdates", "blocklistState", "contributors", "creator",
 "description", "developers", "homepageURL", "iconURL", "id", "install", "installDate", "isActive",
 "isCompatible", "isPlatformCompatible", "name", "operationsRequiringRestart", "optionsURL",
 "pendingOperations", "pendingUpgrade", "permissions", "providesUpdatesSecurely", "releaseNotesURI",
 "scope", "screenshots", "size", "sourceURI", "translators", "type", "updateDate", "userDisabled",
 "version"].forEach(function (prop) {
    Object.defineProperty(Addon.prototype, prop, {
        get: function get_proxy() this.addon[prop],
        set: function set_proxy(val) this.addon[prop] = val
    });
});

var AddonList = Class("AddonList", {
    init: function init(modules, types, filter) {
        this.modules = modules;
        this.filter = filter && filter.toLowerCase();
        this.nodes = {};
        this.addons = [];
        this.ready = false;

        AddonManager.getAddonsByTypes(types, this.closure(function (addons) {
            this._addons = addons;
            if (this.document)
                this._init();
        }));
        AddonManager.addAddonListener(this);
    },
    cleanup: function cleanup() {
        AddonManager.removeAddonListener(this);
    },

    _init: function _init() {
        this._addons.forEach(this.closure.addAddon);
        this.ready = true;
        this.update();
    },

    message: Class.Memoize(function () {
        DOM.fromJSON(["table", { highlight: "Addons", key: "list" },
                        ["tr", { highlight: "AddonHead" },
                            ["td", {}, _("title.Name")],
                            ["td", {}, _("title.Version")],
                            ["td"],
                            ["td", {}, _("title.Status")],
                            ["td", {}, _("title.Description")]]],
                      this.document, this.nodes);

        if (this._addons)
            this._init();

        return this.nodes.list;
    }),

    addAddon: function addAddon(addon) {
        if (addon.id in this.addons)
            this.update(addon);
        else {
            if (this.filter && addon.name.toLowerCase().indexOf(this.filter) === -1)
                return;

            addon = Addon(addon, this);
            this.addons[addon.id] = addon;

            let index = values(this.addons).sort(function (a, b) a.compare(b))
                                           .indexOf(addon);

            this.nodes.list.insertBefore(addon.nodes.row,
                                         this.nodes.list.childNodes[index + 1]);
            this.update();
        }
    },
    removeAddon: function removeAddon(addon) {
        if (addon.id in this.addons) {
            this.nodes.list.removeChild(this.addons[addon.id].nodes.row);
            delete this.addons[addon.id];
            this.update();
        }
    },

    leave: function leave(stack) {
        if (stack.pop)
            this.cleanup();
    },

    update: function update(addon) {
        if (addon && addon.id in this.addons)
            this.addons[addon.id].update();
        if (this.ready)
            this.modules.mow.resize(false);
    },

    onDisabled:           function (addon) { this.update(addon); },
    onDisabling:          function (addon) { this.update(addon); },
    onEnabled:            function (addon) { this.update(addon); },
    onEnabling:           function (addon) { this.update(addon); },
    onInstalled:          function (addon) { this.addAddon(addon); },
    onInstalling:         function (addon) { this.update(addon); },
    onUninstalled:        function (addon) { this.removeAddon(addon); },
    onUninstalling:       function (addon) { this.update(addon); },
    onOperationCancelled: function (addon) { this.update(addon); },
    onPropertyChanged: function onPropertyChanged(addon, properties) {}
});

var Addons = Module("addons", {
    errors: Class.Memoize(function ()
            array(["ERROR_NETWORK_FAILURE", "ERROR_INCORRECT_HASH",
                   "ERROR_CORRUPT_FILE", "ERROR_FILE_ACCESS"])
                .map(function (e) [AddonManager[e], _("AddonManager." + e)])
                .toObject())
}, {
}, {
    commands: function initCommands(dactyl, modules, window) {
        const { CommandOption, commands, completion, io } = modules;

        commands.add(["addo[ns]", "ao"],
            "List installed extensions",
            function (args) {
                let addons = AddonList(modules, args["-types"], args[0]);
                modules.commandline.echo(addons);

                if (modules.commandline.savingOutput)
                    util.waitFor(function () addons.ready);
            },
            {
                argCount: "?",
                options: [
                    {
                        names: ["-types", "-type", "-t"],
                        description: "The add-on types to list",
                        default: ["extension"],
                        completer: function (context, args) completion.addonType(context),
                        type: CommandOption.LIST
                    }
                ]
            });

        let addonListener = AddonListener(modules);

        commands.add(["exta[dd]"],
            "Install an extension",
            function (args) {
                let url  = args[0];
                let file = io.File(url);
                function install(addonInstall) {
                    addonInstall.addListener(addonListener);
                    addonInstall.install();
                }

                if (!file.exists())
                    AddonManager.getInstallForURL(url,   install, "application/x-xpinstall");
                else if (file.isReadable() && file.isFile())
                    AddonManager.getInstallForFile(file, install, "application/x-xpinstall");
                else if (file.isDirectory())
                    dactyl.echoerr(_("addon.cantInstallDir", file.path.quote()));
                else
                    dactyl.echoerr(_("io.notReadable", file.path));
            }, {
                argCount: "1",
                completer: function (context) {
                    context.filters.push(function ({ isdir, text }) isdir || /\.xpi$/.test(text));
                    completion.file(context);
                },
                literal: 0
            });

        // TODO: handle extension dependencies
        values(actions).forEach(function (command) {
            let perm = command.perm && AddonManager["PERM_CAN_" + command.perm.toUpperCase()];
            function ok(addon) (!perm || addon.permissions & perm) && (!command.filter || command.filter(addon));

            commands.add(Array.concat(command.name),
                command.description,
                function (args) {
                    let name = args[0];
                    if (args.bang && !command.bang)
                        dactyl.assert(!name, _("error.trailingCharacters"));
                    else
                        dactyl.assert(name, _("error.argumentRequired"));

                    AddonManager.getAddonsByTypes(args["-types"], dactyl.wrapCallback(function (list) {
                        if (!args.bang || command.bang) {
                            list = list.filter(function (addon) addon.id == name || addon.name == name);
                            dactyl.assert(list.length, _("error.invalidArgument", name));
                            dactyl.assert(list.some(ok), _("error.invalidOperation"));
                            list = list.filter(ok);
                        }
                        dactyl.assert(list.every(ok));
                        if (command.actions)
                            command.actions(list, this.modules);
                        else
                            list.forEach(function (addon) command.action.call(this.modules, addon, args.bang), this);
                    }));
                }, {
                    argCount: "?", // FIXME: should be "1"
                    bang: true,
                    completer: function (context, args) {
                        completion.addon(context, args["-types"]);
                        context.filters.push(function ({ item }) ok(item));
                    },
                    literal: 0,
                    options: [
                        {
                            names: ["-types", "-type", "-t"],
                            description: "The add-on types to operate on",
                            default: ["extension"],
                            completer: function (context, args) completion.addonType(context),
                            type: CommandOption.LIST
                        }
                    ]
                });
        });
    },
    completion: function initCompletion(dactyl, modules, window) {
        completion.addonType = function addonType(context) {
            let base = ["extension", "theme"];
            function update(types) {
                context.completions = types.map(function (t) [t, util.capitalize(t)]);
            }

            context.generate = function generate() {
                update(base);
                if (AddonManager.getAllAddons) {
                    context.incomplete = true;
                    AddonManager.getAllAddons(function (addons) {
                        context.incomplete = false;
                        update(array.uniq(base.concat(addons.map(function (a) a.type)),
                                          true));
                    });
                }
            };
        };

        completion.addon = function addon(context, types) {
            context.title = ["Add-on"];
            context.anchored = false;
            context.keys = {
                text: function (addon) [addon.name, addon.id],
                description: "description",
                icon: "iconURL"
            };
            context.generate = function () {
                context.incomplete = true;
                AddonManager.getAddonsByTypes(types || ["extension"], function (addons) {
                    context.incomplete = false;
                    context.completions = addons;
                });
            };
        };
    }
});

if (!services.has("extensionManager"))
    Components.utils.import("resource://gre/modules/AddonManager.jsm", this);
else
    var AddonManager = {
        PERM_CAN_UNINSTALL: 1,
        PERM_CAN_ENABLE: 2,
        PERM_CAN_DISABLE: 4,
        PERM_CAN_UPGRADE: 8,

        getAddonByID: function (id, callback) {
            callback = callback || util.identity;
            addon = services.extensionManager.getItemForID(id);
            if (addon)
                addon = this.wrapAddon(addon);
            return callback(addon);
        },

        wrapAddon: function wrapAddon(addon) {
            addon = Object.create(addon.QueryInterface(Ci.nsIUpdateItem));

            ["aboutURL", "creator", "description", "developers",
             "homepageURL", "installDate", "optionsURL",
             "releaseNotesURI", "updateDate"].forEach(function (item) {
                memoize(addon, item, function (item) this.getProperty(item));
            });

            update(addon, {

                get permissions() 1 | (this.userDisabled ? 2 : 4),

                appDisabled: false,

                getProperty: function getProperty(property) {
                    let resource = services.rdf.GetResource("urn:mozilla:item:" + this.id);

                    if (resource) {
                        let target = services.extensionManager.datasource.GetTarget(resource,
                            services.rdf.GetResource("http://www.mozilla.org/2004/em-rdf#" + property), true);

                        if (target && target instanceof Ci.nsIRDFLiteral)
                            return target.Value;
                    }

                    return "";
                },

                installLocation: Class.Memoize(function () services.extensionManager.getInstallLocation(this.id)),
                getResourceURI: function getResourceURI(path) {
                    let file = this.installLocation.getItemFile(this.id, path);
                    return services.io.newFileURI(file);
                },

                get isActive() this.getProperty("isDisabled") != "true",

                uninstall: function uninstall() {
                    services.extensionManager.uninstallItem(this.id);
                },

                get userDisabled() this.getProperty("userDisabled") === "true",
                set userDisabled(val) {
                    services.extensionManager[val ? "disableItem" : "enableItem"](this.id);
                }
            });

            return addon;
        },

        getAddonsByTypes: function (types, callback) {
            let res = [];
            for (let [, type] in Iterator(types))
                for (let [, item] in Iterator(services.extensionManager
                            .getItemList(Ci.nsIUpdateItem["TYPE_" + type.toUpperCase()], {})))
                    res.push(this.wrapAddon(item));

            if (callback)
                util.timeout(function () { callback(res); });
            return res;
        },

        getInstallForFile: function (file, callback, mimetype) {
            callback({
                addListener: function () {},
                install: function () {
                    services.extensionManager.installItemFromFile(file, "app-profile");
                }
            });
        },

        getInstallForURL: function (url, callback, mimetype) {
            util.assert(false, _("error.unavailable", config.host, services.runtime.version));
        },

        observers: [],
        addAddonListener: function (listener) {
            observer.listener = listener;
            function observer(subject, topic, data) {
                if (subject instanceof Ci.nsIUpdateItem)
                    subject = AddonManager.wrapAddon(subject);

                if (data === "item-installed")
                    listener.onInstalling(subject, true);
                else if (data === "item-uninstalled")
                    listener.onUnistalling(subject, true);
                else if (data === "item-upgraded")
                    listener.onInstalling(subject, true);
                else if (data === "item-enabled")
                    listener.onEnabling(subject, true);
                else if (data === "item-disabled")
                    listener.onDisabling(subject, true);
            }
            services.observer.addObserver(observer, "em-action-requested", false);
            this.observers.push(observer);
        },
        removeAddonListener: function (listener) {
            this.observers = this.observers.filter(function (observer) {
                if (observer.listener !== listener)
                    return true;
                services.observer.removeObserver(observer, "em-action-requested");
            });
        }
    };

endModule();

} catch(e){ if (isString(e)) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
