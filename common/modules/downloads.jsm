// Copyright (c) 2011-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("downloads", {
    exports: ["Download", "Downloads", "downloads"],
    require: ["util"]
});

lazyRequire("overlay", ["overlay"]);
lazyRequire("promises", ["Task", "promises"]);

lazyRequire("resource://gre/modules/Downloads.jsm", ["Downloads"]);
lazyRequire("resource://gre/modules/DownloadUtils.jsm", ["DownloadUtils"]);

var MAX_LOAD_TIME = 10 * 1000;

let prefix = "DOWNLOAD_";
var states = iter([v, k.slice(prefix.length).toLowerCase()]
                  for ([k, v] in Iterator(Ci.nsIDownloadManager))
                  if (k.startsWith(prefix)))
                .toObject();

var Download = Class("Download", {
    init: function init(download, list) {
        this.download = download;
        this.list = list;

        this.nodes = {
            commandTarget: this
        };
        DOM.fromJSON(
            ["tr", { highlight: "Download", key: "row" },
                ["td", { highlight: "DownloadTitle" },
                    ["span", { highlight: "Link" },
                        ["a", { key: "launch", href: this.target.spec, path: this.targetFile.path },
                            this.displayName],
                        ["span", { highlight: "LinkInfo" },
                            this.targetFile.path]]],
                ["td", { highlight: "DownloadState", key: "state" }],
                ["td", { highlight: "DownloadButtons Buttons" },
                    ["a", { highlight: "Button", href: "javascript:0", key: "stop"   }, _("download.action.Stop")],
                    ["a", { highlight: "Button", href: "javascript:0", key: "remove" }, _("download.action.Remove")],
                    ["a", { highlight: "Button", href: "javascript:0", key: "resume" }, _("download.action.Resume")],
                    ["a", { highlight: "Button", href: "javascript:0", key: "delete" }, _("download.action.Delete")]],
                ["td", { highlight: "DownloadProgress", key: "progress" },
                    ["span", { highlight: "DownloadProgressHave", key: "progressHave" }],
                    "/",
                    ["span", { highlight: "DownloadProgressTotal", key: "progressTotal" }]],,
                ["td", { highlight: "DownloadPercent", key: "percent" }],
                ["td", { highlight: "DownloadSpeed", key: "speed" }],
                ["td", { highlight: "DownloadTime", key: "time" }],
                ["td", {},
                    ["a", { highlight: "DownloadSource", key: "source", href: this.source.url },
                        this.source.url]]],
            this.list.document, this.nodes);

        this.nodes.launch.addEventListener("click", (event) => {
            if (event.button == 0) {
                event.preventDefault();
                this.command("launch");
            }
        }, false);

        this.updateStatus();
        return this;
    },

    get active() !this.stopped,

    get targetFile() File(this.download.target.path),

    get displayName() this.targetFile.leafName,

    get status() states[this.state],

    inState: function inState(states) states.indexOf(this.status) >= 0,

    allowedCommands: Class.Memoize(function () let (self = this) ({
        get delete() !self.active && (self.targetFile.exists() || self.hasPartialData),
        get launch() self.targetFile.exists() && self.succeeded,
        get stop()  self.active,
        get remove() !self.active,
        get resume() self.canceled
    })),

    command: function command(name) {
        util.assert(hasOwnProperty(this.allowedCommands, name), _("download.unknownCommand"));
        util.assert(this.allowedCommands[name], _("download.commandNotAllowed"));

        if (hasOwnProperty(this.commands, name))
            this.commands[name].call(this);
    },

    commands: {
        delete: promises.task(function delete_() {
            if (this.hasPartialData)
                yield this.removePartialData();
            else if (this.targetFile.exists())
                this.targetFile.remove(false);
            this.updateStatus();
        }),
        launch: function launch() {
            // Behavior mimics that of the builtin Download Manager.
            function action() {
                try {
                    if (this.MIMEInfo && this.MIMEInfo.preferredAction == this.MIMEInfo.useHelperApp)
                        this.MIMEInfo.launchWithFile(file.file);
                    else
                        file.launch();
                }
                catch (e) {
                    services.externalProtocol.loadUrl(this.target);
                }
            }

            let file = io.File(this.targetFile);
            if (file.isExecutable() && prefs.get("browser.download.manager.alertOnEXEOpen", true))
                this.list.modules.commandline.input(_("download.prompt.launchExecutable") + " ",
                    (resp) => {
                        if (/^a(lways)$/i.test(resp)) {
                            prefs.set("browser.download.manager.alertOnEXEOpen", false);
                            resp = "yes";
                        }
                        if (/^y(es)?$/i.test(resp))
                            action.call(this);
                    });
            else
                action.call(this);
        },
        resume: function resume() {
            this.download.start();
        },
        remove: promises.task(function remove() {
            yield this.list.list.remove(this.download);
            yield this.download.finalize(true);
        }),
        stop: function stop() {
            this.download.cancel();
        },
    },

    _compare: {
        active:   (a, b) => a.active - b.active,
        complete: (a, b) => a.percentComplete - b.percentComplete,
        date:     (a, b) => a.startTime - b.startTime,
        filename: (a, b) => String.localeCompare(a.targetFile.leafName, b.targetFile.leafName),
        size:     (a, b) => a.totalBytes - b.totalBytes,
        speed:    (a, b) => a.speed - b.speed,
        time:     (a, b) => a.timeRemaining - b.timeRemaining,
        url:      (a, b) => String.localeCompare(a.source.url, b.source.url)
    },

    compare: function compare(other) values(this.list.sortOrder).map(function (order) {
        let val = this._compare[order.substr(1)](this, other);

        return (order[0] == "-") ? -val : val;
    }, this).find(util.identity) || 0,

    timeRemaining: Infinity,

    updateProgress: function updateProgress() {
        let self = this.__proto__;

        if (!this.active) {
            this.nodes.speed.textContent = "";
            this.nodes.time.textContent = "";
        }
        else {
            this.nodes.speed.textContent = util.formatBytes(this.speed, 1, true) + "/s";

            if (this.speed == 0 || !this.hasProgress)
                this.nodes.time.textContent = _("download.unknown");
            else {
                let seconds = (this.totalBytes - this.currentBytes) / this.speed;
                [, self.timeRemaining] = DownloadUtils.getTimeLeft(seconds, this.timeRemaining);
                if (this.timeRemaining)
                    this.nodes.time.textContent = util.formatSeconds(this.timeRemaining);
                else
                    this.nodes.time.textContent = _("download.almostDone");
            }
        }

        let total = this.nodes.progressTotal.textContent =
            this.hasProgress && (this.totalBytes || !this.nActive)
                ? util.formatBytes(this.totalBytes, 1, true)
                : _("download.unknown");

        let suffix = RegExp(/( [a-z]+)?$/i.exec(total)[0] + "$");
        this.nodes.progressHave.textContent = util.formatBytes(this.currentBytes, 1, true).replace(suffix, "");

        this.nodes.percent.textContent = this.hasProgress ? this.progress + "%" : "";
    },

    updateStatus: function updateStatus() {

        this.nodes.row[this.active ? "setAttribute" : "removeAttribute"]("active", "true");

        this.nodes.row.setAttribute("status", this.status);
        this.nodes.state.textContent = util.capitalize(this.status);

        for (let node in values(this.nodes))
            if (node.update)
                node.update();

        this.updateProgress();
    }
});

var DownloadList = Class("DownloadList",
                         XPCOM([Ci.nsIDownloadProgressListener,
                                Ci.nsIObserver,
                                Ci.nsISupportsWeakReference]), {
    init: function init(modules, filter, sort) {
        this.sortOrder = sort;
        this.modules = modules;
        this.filter = filter && filter.toLowerCase();
        this.nodes = {
            commandTarget: this
        };
        this.downloads = Map();
    },

    cleanup: function cleanup() {
        if (this.list)
            this.list.removeView(this);
        this.dead = true;
    },

    message: Class.Memoize(function () {

        DOM.fromJSON(["table", { highlight: "Downloads", key: "list" },
                        ["tr", { highlight: "DownloadHead", key: "head" },
                            ["span", {}, _("title.Title")],
                            ["span", {}, _("title.Status")],
                            ["span"],
                            ["span", {}, _("title.Progress")],
                            ["span"],
                            ["span", {}, _("title.Speed")],
                            ["span", {}, _("title.Time remaining")],
                            ["span", {}, _("title.Source")]],
                        ["tr", { highlight: "Download" },
                            ["span", {},
                                ["div", { style: "min-height: 1ex; /* FIXME */" }]]],
                        ["tr", { highlight: "Download", key: "totals", active: "true" },
                            ["td", {},
                                ["span", { highlight: "Title" },
                                    _("title.Totals") + ":"],
                                " ",
                                ["span", { key: "total" }]],
                            ["td"],
                            ["td", { highlight: "DownloadButtons" },
                                ["a", { highlight: "Button", href: "javascript:0", key: "clear" }, _("download.action.Clear")]],
                            ["td", { highlight: "DownloadProgress", key: "progress" },
                                ["span", { highlight: "DownloadProgressHave", key: "progressHave" }],
                                "/",
                                ["span", { highlight: "DownloadProgressTotal", key: "progressTotal" }]],
                            ["td", { highlight: "DownloadPercent", key: "percent" }],
                            ["td", { highlight: "DownloadSpeed", key: "speed" }],
                            ["td", { highlight: "DownloadTime", key: "time" }],
                            ["td"]]],
                      this.document, this.nodes);

        this.index = Array.indexOf(this.nodes.list.childNodes,
                                   this.nodes.head);

        Task.spawn(function () {
            this.list = yield Downloads.getList(Downloads.ALL);

            let start = Date.now();
            for (let download of yield this.list.getAll()) {
                if (Date.now() - start > MAX_LOAD_TIME) {
                    util.dactyl.warn(_("download.givingUpAfter", (Date.now() - start) / 1000));
                    break;
                }
                this.addDownload(download);
            }
            this.update();

            if (!this.dead)
                this.list.addView(this);
        }.bind(this));
        return this.nodes.list;
    }),

    addDownload: function addDownload(download) {
        if (!this.downloads.has(download)) {
            download = Download(download, this);
            if (this.filter && !download.displayName.contains(this.filter))
                return;

            this.downloads.set(download.download, download);
            let index = values(this.downloads).toArray()
                            .sort((a, b) => a.compare(b))
                            .indexOf(download);

            this.nodes.list.insertBefore(download.nodes.row,
                                         this.nodes.list.childNodes[index + this.index + 1]);
        }
    },
    removeDownload: function removeDownload(download) {
        if (this.downloads.has(download)) {
            this.nodes.list.removeChild(this.downloads.get(download).nodes.row);
            delete this.downloads.delete(download);
        }
    },

    leave: function leave(stack) {
        if (stack.pop)
            this.cleanup();
    },

    allowedCommands: Class.Memoize(function () let (self = this) ({
        get clear() iter(self.downloads.values()).some(dl => dl.allowedCommands.remove)
    })),

    commands: {
        clear: function () {
            this.list.removeFinished();
        }
    },

    sort: function sort() {
        let list = iter(this.downloads.values()).sort((a, b) => a.compare(b));

        for (let [i, download] in iter(list))
            if (this.nodes.list.childNodes[i + 1] != download.nodes.row)
                this.nodes.list.insertBefore(download.nodes.row,
                                             this.nodes.list.childNodes[i + 1]);
    },

    shouldSort: function shouldSort() Array.some(arguments, val => this.sortOrder.some(v => v.substr(1) == val)),

    update: function update() {
        for (let node in values(this.nodes))
            if (node.update && node.update != update)
                node.update();
        this.updateProgress();

        let event = this.document.createEvent("Events");
        event.initEvent("dactyl-commandupdate", true, false);
        this.document.dispatchEvent(event);
    },

    timeRemaining: Infinity,

    updateProgress: function updateProgress() {
        let downloads = iter(this.downloads.values()).toArray();
        let active    = downloads.filter(d => d.active);

        let self = Object.create(this);
        for (let prop in values(["currentBytes", "totalBytes", "speed", "timeRemaining"]))
            this[prop] = active.reduce((acc, dl) => dl[prop] + acc, 0);

        this.hasProgress = active.every(d => d.hasProgress);
        this.progress = Math.round((this.currentBytes / this.totalBytes) * 100);
        this.nActive = active.length;

        Download.prototype.updateProgress.call(self);

        if (active.length)
            this.nodes.total.textContent = _("download.nActive", active.length);
        else for (let key in values(["total", "percent", "speed", "time"]))
            this.nodes[key].textContent = "";

        if (this.shouldSort("complete", "size", "speed", "time"))
            this.sort();
    },

    onDownloadAdded: function onDownloadAdded(download) {
        this.addDownload(download);

        this.modules.mow.resize(false);
        this.nodes.list.scrollIntoView(false);
    },

    onDownloadRemoved: function onDownloadRemoved(download) {
        this.removeDownload(download);
    },

    onDownloadChanged: function onDownloadChanged(download) {
        if (this.downloads.has(download)) {
            download = this.downloads.get(download)

            download.updateStatus();
            download.updateProgress();

            this.update();

            if (this.shouldSort("active"))
                this.sort();
        }
    }
});
["canceled",
 "contentType",
 "currentBytes",
 "error",
 "hasPartialData",
 "hasProgress",
 "launchWhenSucceeded",
 "launcherPath",
 "progress",
 "saver",
 "source",
 "speed",
 "startTime",
 "stopped",
 "succeeded",
 "target",
 "totalBytes",
 "tryToKeepPartialData"].forEach(key => {
    if (!(key in Download.prototype))
        Object.defineProperty(Download.prototype, key, {
            get: function get() this.download[key],
            set: function set(val) this.download[key] = val,
            configurable: true
        });
});


var Downloads_ = Module("downloads", XPCOM(Ci.nsIDownloadProgressListener), {
    init: function () {
        Downloads.getList(Downloads.ALL).then(list => {
            this.list = list;
            if (!this.dead)
                this.list.addView(this);
        });
    },

    cleanup: function destroy() {
        if (this.list)
            this.list.removeView(this);
        this.dead = true;
    },

    onDownloadAdded: function onDownloadAdded(download) {
    },

    onDownloadRemoved: function onDownloadRemoved(download) {
    },

    onDownloadChanged: function onDownloadChanged(download) {
        if (download.succeeded) {
            let target = File(download.target.path);

            let url   = download.source.url;
            let title = target.leafName;
            let file  = target.path;
            let size  = download.totalBytes;

            overlay.modules.forEach(function (modules) {
                modules.dactyl.echomsg({ domains: [util.getHost(url)], message: _("io.downloadFinished", title, file) },
                                       1, modules.commandline.ACTIVE_WINDOW);
                modules.autocommands.trigger("DownloadPost", { url: url, title: title, file: file, size: size });
            });
        }
    }
}, {
}, {
    commands: function initCommands(dactyl, modules, window) {
        const { commands, CommandOption } = modules;

        commands.add(["downl[oads]", "dl"],
            "Display the downloads list",
            function (args) {
                let downloads = DownloadList(modules, args[0], args["-sort"]);
                modules.commandline.echo(downloads);
            },
            {
                argCount: "?",
                options: [
                    {
                        names: ["-sort", "-s"],
                        description: "Sort order (see 'downloadsort')",
                        type: CommandOption.LIST,
                        get default() modules.options["downloadsort"],
                        completer: function (context, args) modules.options.get("downloadsort").completer(context, { values: args["-sort"] }),
                        validator: function (value) modules.options.get("downloadsort").validator(value)
                    }
                ]
            });

        commands.add(["dlc[lear]"],
            "Clear completed downloads",
            function (args) { downloads.list.removeFinished(); });
    },
    options: function initOptions(dactyl, modules, window) {
        const { options } = modules;

        if (false)
        options.add(["downloadcolumns", "dlc"],
            "The columns to show in the download manager",
            "stringlist", "filename,state,buttons,progress,percent,time,url",
            {
                values: {
                    buttons:    "Control buttons",
                    filename:   "Target filename",
                    percent:    "Percent complete",
                    size:       "File size",
                    speed:      "Download speed",
                    state:      "The download's state",
                    time:       "Time remaining",
                    url:        "Source URL"
                }
            });

        options.add(["downloadsort", "dlsort", "dls"],
            ":downloads sort order",
            "stringlist", "-active,+filename",
            {
                values: {
                    active:     "Whether download is active",
                    complete:   "Percent complete",
                    date:       "Date and time the download began",
                    filename:   "Target filename",
                    size:       "File size",
                    speed:      "Download speed",
                    time:       "Time remaining",
                    url:        "Source URL"
                },

                completer: function (context, extra) {
                    let seen = RealSet(extra.values.map(val => val.substr(1)));

                    context.completions = iter(this.values).filter(([k, v]) => !seen.has(k))
                                                           .map(([k, v]) => [["+" + k, [v, " (", _("sort.ascending"), ")"].join("")],
                                                                             ["-" + k, [v, " (", _("sort.descending"), ")"].join("")]])
                                                           .flatten().array;
                },

                has: function () Array.some(arguments, val => this.value.some(v => v.substr(1) == val)),

                validator: function (value) {
                    let seen = RealSet();
                    return value.every(val => /^[+-]/.test(val) && hasOwnProperty(this.values, val.substr(1))
                                                                && !seen.add(val.substr(1)))
                        && value.length;
                }
            });
    }
});

endModule();

// catch(e){ if (isString(e)) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
