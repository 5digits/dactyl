// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

var StatusLine = Module("statusline", {
    init: function init() {
        this._statusLine = document.getElementById("status-bar");
        this.statusBar = document.getElementById("addon-bar") || this._statusLine;

        this.baseGroup = this.statusBar == this._statusLine ? "StatusLine " : "";

        if (this.statusBar.localName == "toolbar" &&
            this.statusBar.parentNode.id != "browser-bottombox")
            overlay.overlayWindow(window, {
                objects: this,
                append: [
                    ["vbox", { id: "browser-bottombox", xmlns: "xul" },
                        ["toolbar", { id: "dactyl-addon-bar",
                                      customizable: true,
                                      defaultset: "",
                                      toolboxid: "navigator-toolbox",
                                      toolbarname: /*L*/ "Add-on Bar",
                                      class: "toolbar-primary chromeclass-toolbar",
                                      mode: "icons",
                                      iconsize: "small", defaulticonsize: "small",
                                      key: "statusBar" },
                            ["statusbar", { id: "dactyl-status-bar", key: "_statusLine" }]]]
                ]
            });

        config.tabbrowser.getStatusPanel().hidden = true;

        if (this.statusBar.localName == "toolbar") {
            styles.system.add("addon-bar", config.styleableChrome, literal(function () /*
                #status-bar, #dactyl-status-bar { margin-top: 0 !important; }
                #dactyl-status-bar { min-height: 0 !important; }
                :-moz-any(#addon-bar, #dactyl-addon-bar) > statusbar { -moz-box-flex: 1 }
                :-moz-any(#addon-bar, #dactyl-addon-bar) > xul|toolbarspring { visibility: collapse; }
                #browser-bottombox>#addon-bar > #addonbar-closebutton { visibility: collapse; }
            */$));

            overlay.overlayWindow(window, {
                append: [
                    ["statusbar", { id: this._statusLine.id, ordinal: "0" }]]
            });

            highlight.loadCSS(util.compileMacro(literal(function () /*
                !AddonBar;#browser-bottombox>#addon-bar,#dactyl-addon-bar {
                    padding-left: 0 !important;
                    padding-top: 0 !important;
                    padding-bottom: 0 !important;
                    min-height: 18px !important;
                    -moz-appearance: none !important;
                    <padding>
                }
                !AddonButton;#browser-bottombox>#addon-bar xul|toolbarbutton, #dactyl-addon-bar xul|toolbarbutton {
                    -moz-appearance: none !important;
                    padding: 0 !important;
                    border-width: 0px !important;
                    min-width: 0 !important;
                    color: inherit !important;
                }
                AddonButton:not(:hover)  background: transparent;
            */$))({ padding: config.OS.isMacOSX ? "padding-right: 10px !important;" : "" }));

            if (document.getElementById("appmenu-button"))
                highlight.loadCSS(literal(function () /*
                    AppmenuButton       min-width: 0 !important; padding: 0 .5em !important;
                */$));
        }

        let _commandline = "if (window.dactyl) return dactyl.modules.commandline";
        let prepend = [
            ["button", { id: "appmenu-button", label: "", image: "chrome://branding/content/icon16.png", highlight: "AppmenuButton", xmlns: "xul" }],
            ["toolbarbutton", { id: "appmenu-toolbar-button", label: "", image: "chrome://branding/content/icon16.png" }],
            ["statusbar", { id: this._statusLine.id, highlight: "StatusLine", xmlns: "xul" },
                // <!-- insertbefore="dactyl.statusBefore;" insertafter="dactyl.statusAfter;" -->
                ["hbox", { key: "container", hidden: "false", align: "center",  flex: "1" },
                    ["stack", { orient: "horizontal",       align: "stretch", flex: "1", highlight: "CmdLine StatusCmdLine", class: "dactyl-container" },
                        ["hbox", {                                                       highlight: "CmdLine StatusCmdLine", class: "dactyl-container" },
                            ["label", { key: "mode",          crop: "end",                                                   class: "plain", collapsed: "true" }],
                            ["stack", {  id: "dactyl-statusline-stack",       flex: "1", highlight: "CmdLine StatusCmdLine", class: "dactyl-container" },
                                ["textbox", { key: "url",     crop: "end",    flex: "1", style: "background: transparent;",  class: "plain dactyl-status-field-url",
                                              readonly: "true" }],
                                ["hbox", { key: "message-box" },
                                    ["label", { key: "message-pre", highlight: "WarningMsg StatusWarningMsg", class: "plain", readonly: "true" }],
                                    ["textbox", { key: "message", crop: "end",    flex: "1", highlight: "Normal StatusNormal",   class: "plain",
                                                  readonly: "true" }]]]]],
                    ["label", { class: "plain", key: "inputbuffer",    flex: "0" }],
                    ["label", { class: "plain", key: "progress",       flex: "0" }],
                    ["label", { class: "plain", key: "tabcount",       flex: "0" }],
                    ["label", { class: "plain", key: "bufferposition", flex: "0" }],
                    ["label", { class: "plain", key: "zoomlevel",      flex: "0" }]],
                // just hide them since other elements expect them
                ["statusbarpanel", { id: "statusbar-display",       hidden: "true" }],
                ["statusbarpanel", { id: "statusbar-progresspanel", hidden: "true" }]]];

        (function rec(ary) {
            ary.forEach(function (elem) {
                if ("key" in elem[1])
                    elem[1].id = "dactyl-statusline-field-" + elem[1].key;
                if (elem.length > 2)
                    rec(elem.slice(2));
            });
        })(prepend);

        overlay.overlayWindow(window, {
            objects: this.widgets = { get status() this.container },
            prepend: prepend
        });

        try {
            this.security = content.document.dactylSecurity || "insecure";
        }
        catch (e) {}
    },

    cleanup: function cleanup(reason) {
        if (reason != "unload" && "CustomizableUI" in window)
            CustomizableUI.unregisterArea(this.statusBar.id, false);
    },

    get visible() !this.statusBar.collapsed && !this.statusBar.hidden,

    signals: {
        "browser.locationChange": function (webProgress, request, uri) {
            let win = webProgress.DOMWindow;
            this.status = uri;
            this.progress = uri && win && win.dactylProgress || "";

            // if this is not delayed we get the position of the old buffer
            this.timeout(function () {
                this.updateBufferPosition();
                this.updateZoomLevel();
            }, 500);
        },
        "browser.overLink": function (link) {
            switch (options["showstatuslinks"]) {
            case "status":
                this.overLink = link ? _("status.link", link) : null;
                this.status = link ? _("status.link", link) : buffer.uri;
                break;
            case "command":
                this.overLink = null;
                if (link)
                    dactyl.echo(_("status.link", link), commandline.FORCE_SINGLELINE);
                else
                    commandline.clear();
                break;
            }
        },
        "browser.progressChange": function onProgressChange(webProgress, request, curSelfProgress, maxSelfProgress, curTotalProgress, maxTotalProgress) {
            if (webProgress && webProgress.DOMWindow)
                webProgress.DOMWindow.dactylProgress = curTotalProgress / maxTotalProgress;
            this.progress = curTotalProgress / maxTotalProgress;
        },
        "browser.securityChange": function onSecurityChange(webProgress, request, state) {

            if (state & Ci.nsIWebProgressListener.STATE_IS_BROKEN)
                this.security = "broken";
            else if (state & Ci.nsIWebProgressListener.STATE_IDENTITY_EV_TOPLEVEL)
                this.security = "extended";
            else if (state & Ci.nsIWebProgressListener.STATE_SECURE_HIGH)
                this.security = "secure";
            else // if (state & Ci.nsIWebProgressListener.STATE_IS_INSECURE)
                this.security = "insecure";

            if (webProgress && webProgress.DOMWindow)
                webProgress.DOMWindow.document.dactylSecurity = this.security;
        },
        "browser.stateChange": function onStateChange(webProgress, request, flags, status) {
            const L = Ci.nsIWebProgressListener;

            if (flags & (L.STATE_IS_DOCUMENT | L.STATE_IS_WINDOW))
                if (flags & L.STATE_START)
                    this.progress = 0;
                else if (flags & L.STATE_STOP)
                    this.progress = "";

            if (flags & L.STATE_STOP)
                this.updateStatus();
        },
        "browser.statusChange": function onStatusChange(webProgress, request, status, message) {
            this.timeout(function () {
                this.status = message || buffer.uri;
            });
        },
        "fullscreen": function onFullscreen(fullscreen) {
            let go = options.get("guioptions");
            if (fullscreen) {
                this.wasVisible = go.has("s");
                go.op("-", "s");
            }
            else if (this.wasVisible) {
                go.op("+", "s");
            }
        }
    },

    /**
     * Update the status bar to indicate how secure the website is:
     * extended - Secure connection with Extended Validation(EV) certificate.
     * secure -   Secure connection with valid certificate.
     * broken -   Secure connection with invalid certificate, or
     *            mixed content.
     * insecure - Insecure connection.
     *
     * @param {'extended'|'secure'|'broken'|'insecure'} type
     */
    set security(type) {
        this._security = type;
        const highlightGroup = {
            extended: "StatusLineExtended",
            secure:   "StatusLineSecure",
            broken:   "StatusLineBroken",
            insecure: "StatusLineNormal"
        };

        highlight.highlightNode(this.statusBar, this.baseGroup + highlightGroup[type]);
    },
    get security() this._security,

    // update all fields of the statusline
    update: function update() {
        this.updateStatus();
        this.inputBuffer = "";
        this.progress = "";
        this.updateTabCount();
        this.updateBufferPosition();
        this.updateZoomLevel();
    },

    unsafeURI: deprecated("util.unsafeURI", { get: function unsafeURI() util.unsafeURI }),
    losslessDecodeURI: deprecated("util.losslessDecodeURI", function losslessDecodeURI() util.losslessDecodeURI.apply(util, arguments)),

    /**
     * Update the URL displayed in the status line. Also displays status
     * icons, [+-♥], when there are next and previous pages in the
     * current tab's history, and when the current URL is bookmarked,
     * respectively.
     *
     * @param {string} url The URL to display.
     */
    get status() this._uri,
    set status(uri) {
        let modified = "";
        let url = uri;
        if (isinstance(uri, Ci.nsIURI)) {
            // when session information is available, add [+] when we can go
            // backwards, [-] when we can go forwards
            if (uri.equals(buffer.uri) && window.getWebNavigation) {
                let sh = window.getWebNavigation().sessionHistory;
                if (sh && sh.index > 0)
                    modified += "-";
                if (sh && sh.index < sh.count - 1)
                    modified += "+";
                if (this.bookmarked)
                    modified += UTF8("❤");
            }

            if (modules.quickmarks)
                modified += quickmarks.find(uri.spec.replace(/#.*/, "")).join("");

            url = util.losslessDecodeURI(uri.spec);
        }

        if (url == "about:blank") {
            if (!buffer.title)
                url = _("buffer.noName");
        }
        else {
            url = url.replace(RegExp("^dactyl://help/(\\S+)#(.*)"), (m, n1, n2) => n1 + " " + decodeURIComponent(n2) + " " + _("buffer.help"))
                     .replace(RegExp("^dactyl://help/(\\S+)"), "$1 " + _("buffer.help"));
        }

        if (modified)
            url += " [" + modified + "]";

        this.widgets.url.value = url;
        this._status = uri;
    },

    get bookmarked() this._bookmarked,
    set bookmarked(val) {
        this._bookmarked = val;
        if (this.status)
            this.status = this.status;
    },

    updateStatus: function updateStatus() {
        this.timeout(function () {
            this.status = this.overLink || buffer.uri;
        });
    },

    updateUrl: deprecated("statusline.status", function updateUrl(url) { this.status = url || buffer.uri; }),

    /**
     * Set the contents of the status line's input buffer to the given
     * string. Used primarily when a key press requires further input
     * before being processed, including mapping counts and arguments,
     * along with multi-key mappings.
     *
     * @param {string} buffer
     * @optional
     */
    get inputBuffer() this.widgets.inputbuffer.value,
    set inputBuffer(val) this.widgets.inputbuffer.value = val == null ? "" : val,
    updateInputBuffer: deprecated("statusline.inputBuffer", function updateInputBuffer(val) { this.inputBuffer = val; }),

    /**
     * Update the page load progress bar.
     *
     * @param {string|number} progress The current progress, as follows:
     *    A string          - Displayed literally.
     *    A ratio 0 < n < 1 - Displayed as a progress bar.
     *    A number n <= 0   - Displayed as a "Loading" message.
     *    Any other number  - The progress is cleared.
     */
    progress: Modes.boundProperty({
        get: function progress() this._progress,
        set: function progress(progress) {
            this._progress = progress || "";

            if (isinstance(progress, ["String", _]))
                this.widgets.progress.value = this._progress;
            else if (typeof progress == "number") {
                let progressStr = "";
                if (this._progress <= 0)
                    progressStr = /*L*/"[ Loading...         ]";
                else if (this._progress < 1) {
                    let progress = Math.round(this._progress * 20);
                    progressStr = "["
                        + "===================>                    "
                            .substr(20 - progress, 20)
                        + "]";
                }
                this.widgets.progress.value = progressStr;
            }
        }
    }),
    updateProgress: deprecated("statusline.progress", function updateProgress(progress) {
        this.progress = progress;
    }),

    /**
     * Display the correct tabcount (e.g., [1/5]) on the status bar.
     *
     * @param {boolean} delayed When true, update count after a brief timeout.
     *     Useful in the many cases when an event that triggers an update is
     *     broadcast before the tab state is fully updated.
     * @optional
     */
    updateTabCount: function updateTabCount(delayed) {
        if (dactyl.has("tabs")) {
            if (delayed) {
                this.timeout(() => { this.updateTabCount(false); }, 0);
                return;
            }

            this.widgets.tabcount.value = "[" + (tabs.index(null, true) + 1) + "/" + tabs.visibleTabs.length + "]";
        }
    },

    /**
     * Display the main content's vertical scroll position in the status
     * bar.
     *
     * @param {number} percent The position, as a percentage.
     * @optional
     */
    updateBufferPosition: function updateBufferPosition(percent) {
        if (percent == null) {
            let win = document.commandDispatcher.focusedWindow;
            if (!win)
                return;
            win.scrollY; // intentional - see Kris
            percent = win.scrollY    == 0 ?  0 : // This prevents a forced rendering
                      win.scrollMaxY == 0 ? -1 : win.scrollY / win.scrollMaxY;
        }

        percent = Math.round(percent * 100);

        if (percent < 0)
            var position = "All";
        else if (percent == 0)
            position = "Top";
        else if (percent >= 100)
            position = "Bot";
        else if (percent < 10)
            position = " " + percent + "%";
        else
            position = percent + "%";

        this.widgets.bufferposition.value = position;
    },

    /**
     * Display the main content's zoom level.
     *
     * @param {number} percent The zoom level, as a percentage. @optional
     * @param {boolean} full True if full zoom is in operation. @optional
     */
    updateZoomLevel: function updateZoomLevel(percent=buffer.zoomLevel, full=buffer.fullZoom) {
        if (percent == 100)
            this.widgets.zoomlevel.value = "";
        else {
            percent = ("  " + Math.round(percent)).substr(-3);
            if (full)
                this.widgets.zoomlevel.value = " [" + percent + "%]";
            else
                this.widgets.zoomlevel.value = " (" + percent + "%)";
        }
    }
});

// vim: set fdm=marker sw=4 sts=4 ts=8 et:
