// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

const ConfigBase = Class(ModuleBase, {
    /**
     * Called on dactyl startup to allow for any arbitrary application-specific
     * initialization code. Must call superclass's init function.
     */
    init: function () {
        this.name = services["dactyl:"].name;
        this.idName = services["dactyl:"].idName;
        this.appName = services["dactyl:"].appName;
        this.host = services["dactyl:"].host;

        highlight.styleableChrome = this.styleableChrome;
        highlight.loadCSS(this.CSS);
        highlight.loadCSS(this.helpCSS);

        let img = Image();
        img.src = this.logo || "chrome://" + this.name + "/content/logo.png";
        img.onload = function () {
            highlight.loadCSS(<>{"!Logo  {"}
                     display:    inline-block;
                     background: url({img.src});
                     width:      {img.width}px;
                     height:     {img.height}px;
                 {"}"}</>);
            img = null;
        };
    },

    styleHelp: function () {
        if (!this.helpStyled)
            for (let k in keys(highlight.loaded))
                if (/^(Help|StatusLine)|^(Boolean|Indicator|MoreMsg|Number|Logo|Key(word)?|String)$/.test(k))
                    highlight.loaded[k] = true;
        this.helpCSS = true;
    },

    /**
     * @property {[["string", "string"]]} A sequence of names and descriptions
     *     of the autocommands available in this application. Primarily used
     *     for completion results.
     */
    autocommands: [],

    get browser() window.gBrowser,
    get tabbrowser() window.gBrowser,

    get browserModes() [modes.NORMAL],

    /**
     * @property {Object} Application specific defaults for option values. The
     *     property names must be the options' canonical names, and the values
     *     must be strings as entered via :set.
     */
    defaults: { guioptions: "rb" },

    /**
     * @property {[["string", "string", "function"]]} An array of
     *    dialogs available via the :dialog command.
     *  [0] name - The name of the dialog, used as the first
     *             argument to :dialog.
     *  [1] description - A description of the dialog, used in
     *                    command completion results for :dialog.
     *  [2] action - The function executed by :dialog.
     */
    dialogs: [],

    /**
     * @property {string[]} A list of features available in this
     *    application. Used extensively in feature test macros. Use
     *    dactyl.has(feature) to check for a feature's presence
     *    in this array.
     */
    features: [],

    /**
     * @property {string} The file extension used for command script files.
     *     This is the name string sans "dactyl".
     */
    get fileExtension() this.name.slice(0, -6),

    guioptions: {},

    hasTabbrowser: false,

    /**
     * @property {string} The name of the application that hosts the
     *     extension. E.g., "Firefox" or "XULRunner".
     */
    host: null,

    /**
     * @property {Object} A map between key names for key events should be ignored,
     *     and a mask of the modes in which they should be ignored.
     */
    ignoreKeys: {}, // NOTE: be aware you can't put useful values in here, as "modes.NORMAL" etc. are not defined at this time

    /**
     * @property {string} The ID of the application's main XUL window.
     */
    mainWindowId: window.document.documentElement.id,

    /**
     * @property {[[]]} An array of application specific mode specifications.
     *     The values of each mode are passed to modes.addMode during
     *     dactyl startup.
     */
    modes: [],

    /**
     * @property {string} The name of the extension.
     *    Required.
     */
    name: null,

    /**
     * @property {number} The height (px) that is available to the output
     *     window.
     */
    get outputHeight() this.browser.mPanelContainer.boxObject.height,

    /**
     * @property {[string]} A list of extra scripts in the dactyl or
     *    application namespaces which should be loaded before dactyl
     *    initialization.
     */
    scripts: [],

    tabStrip: Class.memoize(function () window.document.getElementById("TabsToolbar") || this.tabbrowser.mTabContainer),

    /**
     * @property {string} The leaf name of any temp files created by
     *     {@link io.createTempFile}.
     */
    get tempFile() this.name + ".tmp",

    /**
     * @constant
     * @property {string} The default highlighting rules.
     * See {@link Highlights#loadCSS} for details.
     */
    CSS: UTF8(String.replace(<><![CDATA[
        // <css>
        Boolean      color: red;
        Function     color: navy;
        Null         color: blue;
        Number       color: blue;
        Object       color: maroon;
        String       color: green; white-space: pre;

        Key          font-weight: bold;

        Enabled      color: blue;
        Disabled     color: red;

        // Hack to give these groups slightly higher precedence
        // than their unadorned variants.
        CmdCmdLine;[dactyl|highlight]>*  &#x0d; StatusCmdLine;[dactyl|highlight]>*
        CmdNormal;[dactyl|highlight]     &#x0d; StatusNormal;[dactyl|highlight]
        CmdErrorMsg;[dactyl|highlight]   &#x0d; StatusErrorMsg;[dactyl|highlight]
        CmdInfoMsg;[dactyl|highlight]    &#x0d; StatusInfoMsg;[dactyl|highlight]
        CmdModeMsg;[dactyl|highlight]    &#x0d; StatusModeMsg;[dactyl|highlight]
        CmdMoreMsg;[dactyl|highlight]    &#x0d; StatusMoreMsg;[dactyl|highlight]
        CmdQuestion;[dactyl|highlight]   &#x0d; StatusQuestion;[dactyl|highlight]
        CmdWarningMsg;[dactyl|highlight] &#x0d; StatusWarningMsg;[dactyl|highlight]

        !Normal           color: black   !important; background: white   !important; font-weight: normal !important;
        !StatusNormal     color: inherit !important; background: inherit !important;
        ErrorMsg          color: white   !important; background: red     !important; font-weight: bold !important;
        InfoMsg           color: black   !important; background: white   !important;
        StatusInfoMsg     color: inherit !important; background: inherit !important;
        LineNr            color: orange  !important; background: white   !important;
        ModeMsg           color: black   !important; background: white   !important;
        StatusModeMsg     color: inherit !important; background: inherit !important; padding-right: 1em;
        MoreMsg           color: green   !important; background: white   !important;
        StatusMoreMsg                                background: inherit !important;
        Message           white-space: pre-wrap !important; min-width: 100%; width: 100%; padding-left: 4em; text-indent: -4em; display: block;
        !Message String   white-space: pre-wrap;
        NonText           color: blue; background: transparent !important;
        *Preview          color: gray;
        Question          color: green   !important; background: white   !important; font-weight: bold !important;
        StatusQuestion    color: green   !important; background: inherit !important;
        WarningMsg        color: red     !important; background: white   !important;
        StatusWarningMsg  color: red     !important; background: inherit !important;

        !CmdLine;>*       font-family: monospace !important; padding: 1px !important;
        CmdPrompt;.dactyl-commandline-prompt
        CmdInput;.dactyl-commandline-command
        CmdOutput    white-space: pre;

        CompGroup
        CompGroup:not(:first-of-type)  margin-top: .5em;
        CompTitle            color: magenta; background: white; font-weight: bold;
        CompTitle>*          padding: 0 .5ex;
        CompTitleSep         height: 1px; background: magenta; background: -moz-linear-gradient(60deg, magenta, white);
        CompMsg              font-style: italic; margin-left: 16px;
        CompItem
        CompItem:nth-child(2n+1)    background: rgba(0, 0, 0, .04);
        CompItem[selected]   background: yellow;
        CompItem>*           padding: 0 .5ex;
        CompIcon             width: 16px; min-width: 16px; display: inline-block; margin-right: .5ex;
        CompIcon>img         max-width: 16px; max-height: 16px; vertical-align: middle;
        CompResult           width: 34%; overflow: hidden;
        CompDesc             color: gray; width: 62%;
        CompLess             text-align: center; height: 0;    line-height: .5ex; padding-top: 1ex;
        CompLess::after      content: "⌃";
        CompMore             text-align: center; height: .5ex; line-height: .5ex; margin-bottom: -.5ex;
        CompMore::after      content: "⌄";
        CompGroup:last-of-type  padding-bottom: 1.5ex;

        Indicator   color: blue; width: 1.5em; text-align: center;
        Filter      font-weight: bold;

        Keyword     color: red;
        Tag         color: blue;

        Usage
        LineInfo
        Usage>LineInfo          display: none;
        Usage:hover>LineInfo    display: inline;

        !StatusLine         color: white !important; background: black   !important
        StatusLineBroken    color: black !important; background: #FFa0a0 !important /* light-red */
        StatusLineSecure    color: black !important; background: #a0a0FF !important /* light-blue */
        StatusLineExtended  color: black !important; background: #a0FFa0 !important /* light-green */

        TabClose;.tab-close-button
        TabIcon;.tab-icon       min-width: 16px;
        TabText;.tab-text
        TabNumber               font-weight: bold; margin: 0px; padding-right: .8ex;
        TabIconNumber {
            width: 16px;
            margin: 0 2px 0 -18px !important;
            font-weight: bold;
            color: white;
            text-align: center;
            text-shadow: black -1px 0 1px, black 0 1px 1px, black 1px 0 1px, black 0 -1px 1px;
        }

        Title       color: magenta; background: white; font-weight: bold;
        URL         text-decoration: none; color: green; background: inherit;
        URL:hover   text-decoration: underline; cursor: pointer;
        URLExtra    color: gray;

        FrameIndicator;;* {
            /* This gets released into the wild, so everything is important */
            background-color: red !important;
            opacity: 0.5 !important;
            z-index: 999999 !important;
            position: fixed !important;
            top:      0     !important;
            bottom:   0     !important;
            left:     0     !important;
            right:    0     !important;
        }

        !Bell         background-color: black !important;
        Hint;;* {
            /* This gets released into the wild, so everything is important */
            font-size: 10px        !important;
            font-family: monospace !important;
            font-weight: bold      !important;
            background-color: red   !important;
            color:            white !important;
            border:  0px solid ButtonShadow !important;
            padding: 0px 1px                !important;
        }
        Hint::after;;*  content: attr(text) !important;
        HintElem;;*     background-color: yellow  !important; color: black !important;
        HintActive;;*   background-color: #88FF00 !important; color: black !important;
        HintImage;;*    opacity: .5 !important;

        // </css>
    ]]></>, /&#x0d;/g, "\n")),

    helpCSS: UTF8(<><![CDATA[
        // <css>
        Help                                        font-size: 8pt; line-height: 1.4em; font-family: -moz-fixed, monospace;

        HelpArg                                     color: #6A97D4;
        HelpOptionalArg                             color: #6A97D4;

        HelpBody                                    display: block; margin: 1em auto; max-width: 100ex; padding-bottom: 1em; margin-bottom: 4em; border-bottom-width: 1px;
        HelpBorder;*;dactyl://help/*                border-color: silver; border-width: 0px; border-style: solid;
        HelpCode                                    display: block; white-space: pre; margin-left: 2em; font-family: monospace;

        HelpDefault                                 display: inline-block; margin-right: 1ex; white-space: pre;

        HelpDescription                             display: block; clear: right;
        HelpDescription[short]                      clear: none;
        HelpEm;html|em;dactyl://help/*              font-weight: bold; font-style: normal;

        HelpEx                                      display: inline-block; color: #527BBD; font-weight: bold;

        HelpExample                                 display: block; margin: 1em 0;
        HelpExample::before                         content: "Example: "; font-weight: bold;

        HelpInfo                                    display: block; width: 20em; margin-left: auto;
        HelpInfoLabel                               display: inline-block; width: 6em;  color: magenta; font-weight: bold; vertical-align: text-top;
        HelpInfoValue                               display: inline-block; width: 14em; text-decoration: none;             vertical-align: text-top;

        HelpItem                                    display: block; margin: 1em 1em 1em 10em; clear: both;

        HelpKey                                     color: #102663;
        HelpKeyword                                 font-weight: bold; color: navy;

        HelpLink;html|a;dactyl://help/*             text-decoration: none !important;
        HelpLink[href]:hover                        text-decoration: underline !important;
        HelpLink[href^="mailto:"]::after            content: "✉"; padding-left: .2em;
        HelpLink[rel=external] {
            /* Thanks, Wikipedia */
            background: transparent url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAMAAAC67D+PAAAAFVBMVEVmmcwzmcyZzP8AZswAZv////////9E6giVAAAAB3RSTlP///////8AGksDRgAAADhJREFUGFcly0ESAEAEA0Ei6/9P3sEcVB8kmrwFyni0bOeyyDpy9JTLEaOhQq7Ongf5FeMhHS/4AVnsAZubxDVmAAAAAElFTkSuQmCC) no-repeat scroll right center;
            padding-right: 13px;
        }

        HelpOrderedList;ol[level="1"],ol;dactyl://help/*         display: block; list-style: outside decimal;
        HelpOrderedList2;ol[level="2"],ol ol;dactyl://help/*     list-style: outside upper-alpha;
        HelpOrderedList3;ol[level="3"],ol ol ol;dactyl://help/*  list-style: outside lower-roman;
        HelpList;html|ul;dactyl://help/*     display: block; list-style: outside disc;
        HelpListItem;html|li;dactyl://help/* display: list-item;

        HelpNote                                    color: red; font-weight: bold;

        HelpOpt                                     color: #106326;
        HelpOptInfo                                 display: block; margin-bottom: 1ex; padding-left: 4em;

        HelpParagraph;html|p;dactyl://help/*        display: block; margin: 1em 0em;
        HelpParagraph:first-child                   margin-top: 0;
        HelpParagraph:last-child                    margin-bottom: 0;
        HelpSpec                                    display: block; margin-left: -10em; float: left; clear: left; color: #527BBD; margin-right: 1em;

        HelpString                                  color: green; font-weight: normal;
        HelpString::before                          content: '"';
        HelpString::after                           content: '"';
        HelpString[delim]::before                   content: attr(delim);
        HelpString[delim]::after                    content: attr(delim);

        HelpHead;html|h1;dactyl://help/* {
            display: block;
            margin: 2em 0 1em;
            padding-bottom: .2ex;
            border-bottom-width: 1px;
            font-size: 2em;
            font-weight: bold;
            color: #527BBD;
            clear: both;
        }
        HelpSubhead;html|h2;dactyl://help/* {
            display: block;
            margin: 2em 0 1em;
            padding-bottom: .2ex;
            border-bottom-width: 1px;
            font-size: 1.2em;
            font-weight: bold;
            color: #527BBD;
            clear: both;
        }
        HelpSubsubhead;html|h3;dactyl://help/* {
            display: block;
            margin: 1em 0;
            padding-bottom: .2ex;
            font-size: 1.1em;
            font-weight: bold;
            color: #527BBD;
            clear: both;
        }

        HelpTOC
        HelpTOC>ol ol                               margin-left: -1em;

        HelpTab;html|dl;dactyl://help/* {
            display: table;
            width: 100%;
            margin: 1em 0;
            border-bottom-width: 1px;
            border-top-width: 1px;
            padding: .5ex 0;
            table-layout: fixed;
        }
        HelpTabColumn;html|column;dactyl://help/*   display: table-column;
        HelpTabColumn:first-child                   width: 25%;
        HelpTabTitle;html|dt;dactyl://help/*        display: table-cell; padding: .1ex 1ex; font-weight: bold;
        HelpTabDescription;html|dd;dactyl://help/*  display: table-cell; padding: .1ex 1ex; border-width: 0px;
        HelpTabRow;html|dl>html|tr;dactyl://help/*  display: table-row;

        HelpTag                                     display: inline-block; color: #527BBD; margin-left: 1ex; font-size: 8pt; font-weight: bold;
        HelpTags                                    display: block; float: right; clear: right;
        HelpTopic                                   color: #102663;
        HelpType                                    margin-right: 2ex;

        HelpWarning                                 color: red; font-weight: bold;

        HelpXML                                     color: #C5F779; background-color: #444444; font-family: Terminus, Fixed, monospace;
        HelpXMLBlock {                              white-space: pre; color: #C5F779; background-color: #444444;
            border: 1px dashed #aaaaaa;
            display: block;
            margin-left: 2em;
            font-family: Terminus, Fixed, monospace;
        }
        HelpXMLAttribute                            color: #C5F779;
        HelpXMLAttribute::after                     color: #E5E5E5; content: "=";
        HelpXMLComment                              color: #444444;
        HelpXMLComment::before                      content: "<!--";
        HelpXMLComment::after                       content: "-->";
        HelpXMLProcessing                           color: #C5F779;
        HelpXMLProcessing::before                   color: #444444; content: "<?";
        HelpXMLProcessing::after                    color: #444444; content: "?>";
        HelpXMLString                               color: #C5F779; white-space: pre;
        HelpXMLString::before                       content: '"';
        HelpXMLString::after                        content: '"';
        HelpXMLNamespace                            color: #FFF796;
        HelpXMLNamespace::after                     color: #777777; content: ":";
        HelpXMLTagStart                             color: #FFF796; white-space: normal; display: inline-block; text-indent: -1.5em; padding-left: 1.5em;
        HelpXMLTagEnd                               color: #71BEBE;
        HelpXMLText                                 color: #E5E5E5;
        // </css>
    ]]></>)
});

// vim: set fdm=marker sw=4 ts=4 et:
