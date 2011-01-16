// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

var StatusLine = Module("statusline", {
    init: function () {
        this._statusLine = document.getElementById("status-bar");
        this.statusBar = document.getElementById("addon-bar") || this._statusLine;
        this.statusBar.collapsed = true; // it is later restored unless the user sets laststatus=0
        this.baseGroup = this.statusBar == this._statusLine ? "StatusLine " : "";

        if (this.statusBar.localName == "toolbar") {
            styles.system.add("addon-bar", config.styleableChrome, <css><![CDATA[
                #status-bar { margin-top: 0 !important; }
                #addon-bar > statusbar { -moz-box-flex: 1 }
                #addon-bar > #addonbar-closebutton { visibility: collapse; }
                #addon-bar > xul|toolbarspring { visibility: collapse; }
            ]]></css>);
            highlight.loadCSS(<![CDATA[
                !AddonBar;#addon-bar  padding: 0 !important; min-height: 18px !important; -moz-appearance: none !important;
                !AddonButton;#addon-bar>xul|toolbarbutton  {
                    -moz-appearance: none !important;
                    padding: 0 !important;
                    border-width: 0px !important;
                    min-width: 0 !important;
                }
                AddonButton:not(:hover)  background: transparent !important;
            ]]>);
        }

        let _commandline = "if (window.dactyl) return dactyl.modules.commandline";
        let prepend = <e4x xmlns={XUL} xmlns:dactyl={NS}>
            <statusbar id="status-bar" highlight="StatusLine">
                <!-- insertbefore="dactyl.statusBefore;" insertafter="dactyl.statusAfter;" -->
                <hbox key="container" hidden="false" align="center"  flex="1">
                    <stack orient="horizontal"       align="stretch" flex="1" highlight="CmdLine StatusCmdLine" class="dactyl-container">
                        <hbox                                                 highlight="CmdLine StatusCmdLine" class="dactyl-container">
                            <label key="mode"          crop="end"                                               class="plain" collapsed="true"/>
                            <stack                                   flex="1" highlight="CmdLine StatusCmdLine" class="dactyl-container">
                                <textbox key="url"     crop="end"    flex="1"                                   class="plain dactyl-status-field-url" readonly="true"/>
                                <textbox key="message" crop="end"    flex="1" highlight="Normal StatusNormal"   class="plain"                         readonly="true"/>
                            </stack>
                        </hbox>

                        <hbox key="commandline" hidden="false" class="dactyl-container" highlight="Normal StatusNormal" collapsed="true">
                            <label key="commandline-prompt"    class="dactyl-commandline-prompt  plain" flex="0" crop="end" value="" collapsed="true"/>
                            <textbox key="commandline-command" class="dactyl-commandline-command plain" flex="1" type="text" timeout="100"
                                     oninput={_commandline + ".onEvent(event);"} onkeyup={_commandline + ".onEvent(event);"}
                                     onfocus={_commandline + ".onEvent(event);"} onblur={_commandline + ".onEvent(event);"}/>
                        </hbox>
                    </stack>
                    <label class="plain" key="inputbuffer"    flex="0"/>
                    <label class="plain" key="progress"       flex="0"/>
                    <label class="plain" key="tabcount"       flex="0"/>
                    <label class="plain" key="bufferposition" flex="0"/>
                    <label class="plain" key="zoomlevel"      flex="0"/>
                </hbox>
                <!-- just hide them since other elements expect them -->
                <statusbarpanel id="statusbar-display"       hidden="true"/>
                <statusbarpanel id="statusbar-progresspanel" hidden="true"/>
            </statusbar>
        </e4x>;

        for each (let attr in prepend..@key)
            attr.parent().@id = "dactyl-statusline-field-" + attr;

        util.overlayWindow(window, {
            objects: this.widgets = { get status() this.container },
            prepend: prepend.elements()
        });

        this.security = content.document.dactylSecurity || "insecure";
    },

    get visible() !this.statusBar.collapsed && !this.statusBar.hidden,

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
        this.updateUrl();
        this.updateInputBuffer();
        this.updateProgress();
        this.updateTabCount();
        this.updateBufferPosition();
        this.updateZoomLevel();
    },

    /**
     * Update the URL displayed in the status line. Also displays status
     * icons, [+-♥], when there are next and previous pages in the
     * current tab's history, and when the current URL is bookmarked,
     * respectively.
     *
     * @param {string} url The URL to display.
     * @default buffer.uri
     */
    updateUrl: function updateUrl(url) {
        // ripped from Firefox; modified
        function losslessDecodeURI(url) {
            // 1. decodeURI decodes %25 to %, which creates unintended
            //    encoding sequences.
            url = url.split("%25").map(function (url) {
                    // Non-UTF-8 compliant URLs cause "malformed URI sequence" errors.
                    try {
                        return decodeURI(url);
                    }
                    catch (e) {
                        return url;
                    }
                }).join("%25");
            // 2. Re-encode whitespace so that it doesn't get eaten away
            //    by the location bar (bug 410726).
            url = url.replace(/[\r\n\t]/g, encodeURIComponent);

            // Encode invisible characters (soft hyphen, zero-width space, BOM,
            // line and paragraph separator, word joiner, invisible times,
            // invisible separator, object replacement character) (bug 452979)
            url = url.replace(/[\v\x0c\x1c\x1d\x1e\x1f\u00ad\u200b\ufeff\u2028\u2029\u2060\u2062\u2063\ufffc]/g,
                encodeURIComponent);

            // Encode bidirectional formatting characters.
            // (RFC 3987 sections 3.2 and 4.1 paragraph 6)
            url = url.replace(/[\u200e\u200f\u202a\u202b\u202c\u202d\u202e]/g,
                encodeURIComponent);
            return url;
        };

        // TODO: this probably needs a more general solution.
        if (url == null)
            url = buffer.uri.spec;

        // when session information is available, add [+] when we can go
        // backwards, [-] when we can go forwards
        let modified = "";
        if (window.getWebNavigation) {
            let sh = window.getWebNavigation().sessionHistory;
            if (sh && sh.index > 0)
                modified += "+";
            if (sh && sh.index < sh.count - 1)
                modified += "-";
        }
        if (modules.bookmarks) {
            if (bookmarks.isBookmarked(buffer.uri))
                modified += UTF8("❤");
                //modified += UTF8("♥");
        }
        if (modules.quickmarks)
            modified += quickmarks.find(url.replace(/#.*/, "")).join("");

        url = losslessDecodeURI(url);

        // make it even more Vim-like
        if (url == "about:blank") {
            if (!buffer.title)
                url = "[No Name]";
        }
        else {
            url = url.replace(RegExp("^dactyl://help/(\\S+)#(.*)"), function (m, n1, n2) n1 + " " + decodeURIComponent(n2) + " [Help]")
                     .replace(RegExp("^dactyl://help/(\\S+)"), "$1 [Help]");
        }

        if (modified)
            url += " [" + modified + "]";

        this.widgets.url.value = url;
    },

    /**
     * Set the contents of the status line's input buffer to the given
     * string. Used primarily when a key press requires further input
     * before being processed, including mapping counts and arguments,
     * along with multi-key mappings.
     *
     * @param {string} buffer
     * @optional
     */
    updateInputBuffer: function updateInputBuffer(buffer) {
        if (buffer == null)
            buffer = "";

        this.widgets.inputbuffer.value = buffer;
    },

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
        set: function setProgress(progress) {
            if (!progress)
                progress = "";

            if (typeof progress == "string")
                this.widgets.progress.value = progress;
            else if (typeof progress == "number") {
                let progressStr = "";
                if (progress <= 0)
                    progressStr = "[ Loading...         ]";
                else if (progress < 1) {
                    progress = Math.round(progress * 20);
                    progressStr = "["
                        + "===================>                    "
                            .substr(20 - progress, 20)
                        + "]";
                }
                this.widgets.progress.value = progressStr;
            }
        }
    }),
    updateProgress: function updateProgress(progress) {
        this.progress = progress;
    },

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
                this.timeout(function () this.updateTabCount(false), 0);
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
    updateZoomLevel: function updateZoomLevel(percent, full) {
        if (arguments.length == 0)
            [percent, full] = [buffer.zoomLevel, buffer.fullZoom];

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

// vim: set fdm=marker sw=4 ts=4 et:
