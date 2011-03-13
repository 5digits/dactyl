// Copyright (c) 2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

Components.utils.import("resource://dactyl/bootstrap.jsm");
defineModule("downloads", {
    exports: ["Download", "Downloads", "downloads"],
    use: ["io", "prefs", "services", "util"]
}, this);

Cu.import("resource://gre/modules/DownloadUtils.jsm", this);

let prefix = "DOWNLOAD_";
var states = iter([v, k.slice(prefix.length).toLowerCase()]
                  for ([k, v] in Iterator(Ci.nsIDownloadManager))
                  if (k.indexOf(prefix) == 0))
                .toObject();

var Download = Class("Download", {
    init: function init(id, list) {
        let self = XPCSafeJSObjectWrapper(services.downloadManager.getDownload(id));
        self.__proto__ = this;
        this.instance = this;
        this.list = list;

        this.nodes = {
            commandTarget: self
        };
        util.xmlToDom(
            <tr highlight="Download" key="row" xmlns:dactyl={NS} xmlns={XHTML}>
                <td highlight="DownloadTitle">
                    <span highlight="Link">
                        <a key="launch" dactyl:command="download.command"
                           href={self.target.spec} path={self.targetFile.path}>{self.displayName}</a>
                        <span highlight="LinkInfo">{self.targetFile.path}</span>
                    </span>
                </td>
                <td highlight="DownloadState" key="state"/>
                <td highlight="DownloadButtons Buttons">
                    <a highlight="Button" key="pause">Pause</a>
                    <a highlight="Button" key="remove">Remove</a>
                    <a highlight="Button" key="resume">Resume</a>
                    <a highlight="Button" key="retry">Retry</a>
                    <a highlight="Button" key="cancel">Cancel</a>
                    <a highlight="Button" key="delete">Delete</a>
                </td>
                <td highlight="DownloadProgress" key="progress">
                    <span highlight="DownloadProgressHave" key="progressHave"
                    />/<span highlight="DownloadProgressTotal" key="progressTotal"/>
                </td>
                <td highlight="DownloadPercent" key="percent"/>
                <td highlight="DownloadTime" key="time"/>
                <td><a highlight="DownloadSource" key="source" href={self.source.spec}>{self.source.spec}</a></td>
            </tr>,
            this.list.document, this.nodes);

        self.updateStatus();
        return self;
    },

    get status() states[this.state],

    inState: function inState(states) states.indexOf(this.status) >= 0,

    get alive() this.inState(["downloading", "notstarted", "paused", "queued", "scanning"]),

    allowedCommands: Class.memoize(function () let (self = this) ({
        get cancel() self.cancelable && self.inState(["downloading", "paused", "starting"]),
        get delete() !this.cancel && self.targetFile.exists(),
        get launch() self.targetFile.exists() && self.inState(["finished"]),
        get pause() self.inState(["downloading"]),
        get remove() self.inState(["blocked_parental", "blocked_policy",
                                   "canceled", "dirty", "failed", "finished"]),
        get resume() self.resumable && self.inState(["paused"]),
        get retry() self.inState(["canceled", "failed"])
    })),

    command: function command(name) {
        util.assert(set.has(this.allowedCommands, name), _("download.unknownCommand"));
        util.assert(this.allowedCommands[name], _("download.commandNotAllowed"));

        services.downloadManager[name + "Download"](this.id);
    },

    commands: {
        delete: function delete_() {
            this.targetFile.remove(false);
            this.updateStatus();
        },
        launch: function launch() {
            let self = this;
            // Behavior mimics that of the builtin Download Manager.
            function action() {
                try {
                    if (this.MIMEInfo && this.MIMEInfo.preferredAction == this.MIMEInfo.useHelperApp)
                        this.MIMEInfo.launchWithFile(file)
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
                    function (resp) {
                        if (/^a(lways)$/i.test(resp)) {
                            prefs.set("browser.download.manager.alertOnEXEOpen", false);
                            resp = "yes";
                        }
                        if (/^y(es)?$/i.test(resp))
                            action.call(self);
                    });
            else
                action.call(this);
        }
    },

    compare: function compare(other) String.localeCompare(this.displayName, other.displayName),

    timeRemaining: Infinity,

    updateProgress: function updateProgress() {
        let self = this.__proto__;

        if (this.amountTransferred === this.size)
            this.nodes.time.textContent = "";
        else if (this.speed == 0 || this.size == 0)
            this.nodes.time.textContent = "Unknown";
        else {
            let seconds = (this.size - this.amountTransferred) / this.speed;
            [, self.timeRemaining] = DownloadUtils.getTimeLeft(seconds, this.timeRemaining);
            if (this.timeRemaining)
                this.nodes.time.textContent = util.formatSeconds(this.timeRemaining);
            else
                this.nodes.time.textContent = "~1 second";
        }
        let total = this.nodes.progressTotal.textContent = this.size ? util.formatBytes(this.size, 1, true) : "Unknown";
        let suffix = RegExp(/( [a-z]+)?$/i.exec(total)[0] + "$");
        this.nodes.progressHave.textContent = util.formatBytes(this.amountTransferred, 1, true).replace(suffix, "");

        this.nodes.percent.textContent = this.size ? Math.round(this.amountTransferred * 100 / this.size) + "%" : "";
    },

    updateStatus: function updateStatus() {

        this.nodes.row[this.alive ? "setAttribute" : "removeAttribute"]("active", "true");

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
    init: function init(modules, filter) {
        this.modules = modules;
        this.filter = filter && filter.toLowerCase();
        this.nodes = {
            commandTarget: this
        };
        this.downloads = {};
    },
    cleanup: function cleanup() {
        this.observe.unregister();
        services.downloadManager.removeListener(this);
    },

    message: Class.memoize(function () {

        util.xmlToDom(<table highlight="Downloads" key="list" xmlns={XHTML}>
                        <tr highlight="DownloadHead">
                            <span>Title</span>
                            <span>Status</span>
                            <span/>
                            <span>Progress</span>
                            <span/>
                            <span>Time remaining</span>
                            <span>Source</span>
                        </tr>
                        <tr highlight="Download"><span><div style="min-height: 1ex; /* FIXME */"/></span></tr>
                        <tr highlight="Download" key="totals" active="true">
                            <td><span highlight="Title">Totals:</span>&#xa0;<span key="total"/></td>
                            <td/>
                            <td highlight="DownloadButtons">
                                <a highlight="Button" key="clear">Clear</a>
                            </td>
                            <td highlight="DownloadProgress" key="progress">
                                <span highlight="DownloadProgressHave" key="progressHave"
                                />/<span highlight="DownloadProgressTotal" key="progressTotal"/>
                            </td>
                            <td highlight="DownloadPercent" key="percent"/>
                            <td highlight="DownloadTime" key="time"/>
                            <td/>
                        </tr>
                      </table>, this.document, this.nodes);

        for (let row in iter(services.downloadManager.DBConnection
                                     .createStatement("SELECT id FROM moz_downloads")))
            this.addDownload(row.id);
        this.update();

        util.addObserver(this);
        services.downloadManager.addListener(this);
        return this.nodes.list;
    }),

    addDownload: function addDownload(id) {
        if (!(id in this.downloads)) {
            let download = Download(id, this);
            if (this.filter && download.displayName.indexOf(this.filter) === -1)
                return;

            this.downloads[id] = download;
            let index = values(this.downloads).sort(function (a, b) a.compare(b))
                                              .indexOf(download);

            this.nodes.list.insertBefore(download.nodes.row,
                                         this.nodes.list.childNodes[index + 1]);
        }
    },
    removeDownload: function removeDownload(id) {
        if (id in this.downloads) {
            this.nodes.list.removeChild(this.downloads[id].nodes.row);
            delete this.downloads[id];
        }
    },

    leave: function leave(stack) {
        if (stack.pop)
            this.cleanup();
    },

    allowedCommands: Class.memoize(function () let (self = this) ({
        get clear() values(self.downloads).some(function (dl) dl.allowedCommands.remove)
    })),

    commands: {
        clear: function () {
            services.downloadManager.cleanUp();
        }
    },

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
        let downloads = values(this.downloads).toArray();

        let self = Object.create(this);
        for (let prop in values(["amountTransferred", "size", "speed", "timeRemaining"]))
            this[prop] = downloads.reduce(function (acc, dl) dl[prop] + acc, 0);

        Download.prototype.updateProgress.call(self);

        let active = downloads.filter(function (dl) dl.alive).length;
        if (active)
            this.nodes.total.textContent = active + " active";
        else for (let key in values(["total", "percent", "time"]))
            this.nodes[key].textContent = "";
    },

    observers: {
        "download-manager-remove-download": function (id) {
            if (id == null)
                id = [k for ([k, dl] in iter(this.downloads)) if (dl.allowedCommands.remove)];
            else
                id = [id.QueryInterface(Ci.nsISupportsPRUint32).data];

            Array.concat(id).map(this.closure.removeDownload);
            this.update();
        }
    },

    onDownloadStateChange: function (state, download) {
        try {
            if (download.id in this.downloads)
                this.downloads[download.id].updateStatus();
            else {
                this.addDownload(download.id);

                this.modules.mow.resize(false);
                this.nodes.list.scrollIntoView(false);
            }
            this.update();
        }
        catch (e) {
            util.reportError(e);
        }
    },
    onProgressChange: function (webProgress, request,
                                curProgress, maxProgress,
                                curTotalProgress, maxTotalProgress,
                                download) {
        try {
            if (download.id in this.downloads)
                this.downloads[download.id].updateProgress();
            this.updateProgress();
        }
        catch (e) {
            util.reportError(e);
        }
    }
});

var Downloads = Module("downloads", {
}, {
}, {
    commands: function (dactyl, modules, window) {
        const { commands } = modules;

        commands.add(["downl[oads]", "dl"],
            "Display the downloads list",
            function (args) {
                let downloads = DownloadList(modules, args[0]);
                modules.commandline.echo(downloads);
            },
            {
                argCount: "?"
            });
    }
});

endModule();

// catch(e){ if (isString(e)) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
