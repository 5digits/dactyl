// Copyright (c) 2006-2009 by Martin Stubenschrott <stubenschrott@vimperator.org>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var Mail = Module("mail", {
    init: function init() {
        // used for asynchronously selecting messages after wrapping folders
        this._selectMessageKeys = [];
        this._selectMessageCount = 1;
        this._selectMessageReverse = false;

        this._mailSession = Cc["@mozilla.org/messenger/services/session;1"].getService(Ci.nsIMsgMailSession);
        this._notifyFlags = Ci.nsIFolderListener.intPropertyChanged | Ci.nsIFolderListener.event;
        this._mailSession.AddFolderListener(this._folderListener, this._notifyFlags);
    },

    _folderListener: {
        OnItemAdded: function (parentItem, item) {},
        OnItemRemoved: function (parentItem, item) {},
        OnItemPropertyChanged: function (item, property, oldValue, newValue) {},
        OnItemIntPropertyChanged: function (item, property, oldValue, newValue) {},
        OnItemBoolPropertyChanged: function (item, property, oldValue, newValue) {},
        OnItemUnicharPropertyChanged: function (item, property, oldValue, newValue) {},
        OnItemPropertyFlagChanged: function (item, property, oldFlag, newFlag) {},

        OnItemEvent: function (folder, event) {
            let eventType = event.toString();
            if (eventType == "FolderLoaded") {
                if (folder) {
                    let msgFolder = folder.QueryInterface(Ci.nsIMsgFolder);
                    autocommands.trigger("FolderLoaded", { url: msgFolder });

                    // Jump to a message when requested
                    let indices = [];
                    if (mail._selectMessageKeys.length > 0) {
                        for (let j = 0; j < mail._selectMessageKeys.length; j++)
                            indices.push([gDBView.findIndexFromKey(mail._selectMessageKeys[j], true), mail._selectMessageKeys[j]]);

                        indices.sort();
                        let index = mail._selectMessageCount - 1;
                        if (mail._selectMessageReverse)
                            index = mail._selectMessageKeys.length - 1 - index;

                        gDBView.selectMsgByKey(indices[index][1]);
                        mail._selectMessageKeys = [];
                    }
                }
            }
            /*else if (eventType == "ImapHdrDownloaded") {}
            else if (eventType == "DeleteOrMoveMsgCompleted") {}
            else if (eventType == "DeleteOrMoveMsgFailed") {}
            else if (eventType == "AboutToCompact") {}
            else if (eventType == "CompactCompleted") {}
            else if (eventType == "RenameCompleted") {}
            else if (eventType == "JunkStatusChanged") {}*/
        }
    },

    _getCurrentFolderIndex: function () {
        // for some reason, the index is interpreted as a string, therefore the parseInt
        return parseInt(gFolderTreeView.getIndexOfFolder(gFolderTreeView.getSelectedFolders()[0]));
    },

    _getRSSUrl: function () {
        return gDBView.hdrForFirstSelectedMessage.messageId.replace(/(#.*)?@.*$/, "");
    },

    _moveOrCopy: function (copy, destinationFolder, operateOnThread) {
        let folders = mail.getFolders(destinationFolder);
        if (folders.length == 0)
            return void dactyl.echoerr(_("addressbook.noMatchingFolder", destinationFolder));
        else if (folders.length > 1)
            return dactyl.echoerr(_("addressbook.multipleFolderMatches", destinationFolder));

        let count = gDBView.selection.count;
        if (!count)
            return void dactyl.beep();

        (copy ? MsgCopyMessage : MsgMoveMessage)(folders[0]);
        util.timeout(function () {
            dactyl.echomsg(count + " message(s) " + (copy ? "copied" : "moved") + " to " + folders[0].prettyName, 1);
        }, 100);
    },

    _parentIndex: function (index) {
        let parent = index;
        let tree = GetThreadTree();

        while (true) {
            let tmp = tree.view.getParentIndex(parent);
            if (tmp >= 0)
                parent = tmp;
            else
                break;
        }
        return parent;
    },

    // does not wrap yet, intentional?
    _selectUnreadFolder: function (backwards, count) {
        count = Math.max(1, count);
        let direction = backwards ? -1 : 1;
        let c = this._getCurrentFolderIndex();
        let i = direction;
        let folder;
        while (count > 0 && (c + i) < gFolderTreeView.rowCount && (c + i) >= 0) {
            let resource = gFolderTreeView._rowMap[c + i]._folder;
            if (!resource.isServer && resource.getNumUnread(false)) {
                count -= 1;
                folder = i;
            }
            i += direction;
        }
        if (!folder || count > 0)
            dactyl.beep();
        else
            gFolderTreeView.selection.timedSelect(c + folder, 500);
    },

    _escapeRecipient: function (recipient) {
        // strip all ":
        recipient = recipient.replace(/"/g, "");
        return "\"" + recipient + "\"";
    },

    get currentAccount() this.currentFolder.rootFolder,

    get currentFolder() gFolderTreeView.getSelectedFolders()[0],

    /** @property {[nsISmtpServer]} The list of configured SMTP servers. */
    get smtpServers() {
        let servers = services.smtp.smtpServers;
        let res = [];

        while (servers.hasMoreElements()) {
            let server = servers.getNext();
            if (server instanceof Ci.nsISmtpServer)
                res.push(server);
        }

        return res;
    },

    composeNewMail: function (args) {
        let params = Cc["@mozilla.org/messengercompose/composeparams;1"].createInstance(Ci.nsIMsgComposeParams);
        params.composeFields = Cc["@mozilla.org/messengercompose/composefields;1"].createInstance(Ci.nsIMsgCompFields);

        if (args) {
            if (args.originalMsg)
                params.originalMsgURI = args.originalMsg;
            if (args.to)
                params.composeFields.to = args.to;
            if (args.cc)
                params.composeFields.cc = args.cc;
            if (args.bcc)
                params.composeFields.bcc = args.bcc;
            if (args.newsgroups)
                params.composeFields.newsgroups = args.newsgroups;
            if (args.subject)
                params.composeFields.subject = args.subject;
            if (args.body)
                params.composeFields.body = args.body;

            if (args.attachments) {
                while (args.attachments.length > 0) {
                    let url = args.attachments.pop();
                    let file = io.getFile(url);
                    if (!file.exists())
                        return void dactyl.echoerr(_("mail.cantAttachFile", url), commandline.FORCE_SINGLELINE);

                    attachment = Cc["@mozilla.org/messengercompose/attachment;1"].createInstance(Ci.nsIMsgAttachment);
                    attachment.url = "file://" + file.path;
                    params.composeFields.addAttachment(attachment);
                }
            }
        }

        params.type = Ci.nsIMsgCompType.New;

        services.compose.OpenComposeWindowWithParams(null, params);
    },

    // returns an array of nsIMsgFolder objects
    getFolders: function (filter, includeServers, includeMsgFolders) {
        let folders = [];
        if (!filter)
            filter = "";
        else
            filter = filter.toLowerCase();

        if (includeServers === undefined)
            includeServers = false;
        if (includeMsgFolders === undefined)
            includeMsgFolders = true;

        for (let i = 0; i < gFolderTreeView.rowCount; i++) {
            let resource = gFolderTreeView._rowMap[i]._folder;
            if ((resource.isServer && !includeServers) || (!resource.isServer && !includeMsgFolders))
                continue;

            let folderString = resource.server.prettyName + ": " + resource.name;

            if (resource.prettiestName.toLowerCase().indexOf(filter) >= 0)
                folders.push(resource);
            else if (folderString.toLowerCase().indexOf(filter) >= 0)
                folders.push(resource);
        }
        return folders;
    },

    getNewMessages: function (currentAccountOnly) {
        if (currentAccountOnly)
            MsgGetMessagesForAccount();
        else
            GetMessagesForAllAuthenticatedAccounts();
    },

    getStatistics: function (currentAccountOnly) {
        let accounts = currentAccountOnly ? [this.currentAccount]
                                          : this.getFolders("", true, false);

        let unreadCount = 0, totalCount = 0, newCount = 0;
        for (let i = 0; i < accounts.length; i++) {
            let account = accounts[i];
            unreadCount += account.getNumUnread(true); // true == deep (includes subfolders)
            totalCount  += account.getTotalMessages(true);
            newCount    += account.getNumUnread(true);
        }

        return { numUnread: unreadCount, numTotal: totalCount, numNew: newCount };
    },

    collapseThread: function () {
        let tree = GetThreadTree();
        if (tree) {
            let parent = this._parentIndex(tree.currentIndex);
            if (tree.changeOpenState(parent, false)) {
                tree.view.selection.select(parent);
                tree.treeBoxObject.ensureRowIsVisible(parent);
                return true;
            }
        }
        return false;
    },

    expandThread: function () {
        let tree = GetThreadTree();
        if (tree) {
            let row = tree.currentIndex;
            if (row >= 0 && tree.changeOpenState(row, true))
               return true;
        }
        return false;
    },

    /**
     * General-purpose method to find messages.
     *
     * @param {function(nsIMsgDBHdr):boolean} validatorFunc Return
     *     true/false whether msg should be selected or not.
     * @param {boolean} canWrap When true, wraps around folders.
     * @param {boolean} openThreads Should we open closed threads?
     * @param {boolean} reverse Change direction of searching.
     */
    selectMessage: function (validatorFunc, canWrap, openThreads, reverse, count) {
        function currentIndex() {
            let index = gDBView.selection.currentIndex;
            if (index < 0)
                index = 0;
            return index;
        }

        function closedThread(index) {
            if (!(gDBView.viewFlags & nsMsgViewFlagsType.kThreadedDisplay))
                return false;

            index = (typeof index == "number") ? index : currentIndex();
            return !gDBView.isContainerOpen(index) && !gDBView.isContainerEmpty(index);
        }

        if (typeof validatorFunc != "function")
            return;

        if (typeof count != "number" || count < 1)
            count = 1;

        // first try to find in current folder
        if (gDBView) {
            for (let i = currentIndex() + (reverse ? -1 : (openThreads && closedThread() ? 0 : 1));
                    reverse ? (i >= 0) : (i < gDBView.rowCount);
                    reverse ? i-- : i++) {
                let key = gDBView.getKeyAt(i);
                let msg = gDBView.db.GetMsgHdrForKey(key);

                // a closed thread
                if (openThreads && closedThread(i)) {
                    let thread = gDBView.db.GetThreadContainingMsgHdr(msg);
                    let originalCount = count;

                    for (let j = (i == currentIndex() && !reverse) ? 1 : (reverse ? thread.numChildren - 1 : 0);
                             reverse ? (j >= 0) : (j < thread.numChildren);
                             reverse ? j-- : j++) {
                        msg = thread.getChildAt(j);
                        if (validatorFunc(msg) && --count == 0) {
                            // this hack is needed to get the correct message, because getChildAt() does not
                            // necessarily return the messages in the order they are displayed
                            gDBView.selection.timedSelect(i, GetThreadTree()._selectDelay || 500);
                            GetThreadTree().treeBoxObject.ensureRowIsVisible(i);
                            if (j > 0) {
                                GetThreadTree().changeOpenState(i, true);
                                this.selectMessage(validatorFunc, false, false, false, originalCount);
                            }
                            return;
                        }
                    }
                }
                else { // simple non-threaded message
                    if (validatorFunc(msg) && --count == 0) {
                        gDBView.selection.timedSelect(i, GetThreadTree()._selectDelay || 500);
                        GetThreadTree().treeBoxObject.ensureRowIsVisible(i);
                        return;
                    }
                }
            }
        }

        // then in other folders
        if (canWrap) {
            this._selectMessageReverse = reverse;

            let folders = this.getFolders("", true, true);
            let ci = this._getCurrentFolderIndex();
            for (let i = 1; i < folders.length; i++) {
                let index = (i + ci) % folders.length;
                if (reverse)
                    index = folders.length - 1 - index;

                let folder = folders[index];
                if (folder.isServer)
                    continue;

                this._selectMessageCount = count;
                this._selectMessageKeys = [];

                // sometimes folder.getMessages can fail with an exception
                // TODO: find out why, and solve the problem
                try {
                    var msgs = folder.messages;
                }
                catch (e) {
                    msgs = folder.getMessages(msgWindow); // for older thunderbirds
                    dactyl.dump("WARNING: " + folder.prettyName + " failed to getMessages, trying old API");
                    //continue;
                }

                while (msgs.hasMoreElements()) {
                    let msg = msgs.getNext().QueryInterface(Ci.nsIMsgDBHdr);
                    if (validatorFunc(msg)) {
                        count--;
                        this._selectMessageKeys.push(msg.messageKey);
                    }
                }

                if (count <= 0) {
                    // SelectFolder is asynchronous, message is selected in this._folderListener
                    SelectFolder(folder.URI);
                    return;
                }
            }
        }

        // TODO: finally for the "rest" of the current folder

        dactyl.beep();
    },

    setHTML: function (value) {
        let values = [[true,  1, gDisallow_classes_no_html],  // plaintext
                      [false, 0, 0],                          // HTML
                      [false, 3, gDisallow_classes_no_html]]; // sanitized/simple HTML

        if (typeof value != "number" || value < 0 || value > 2)
            value = 1;

        gPrefBranch.setBoolPref("mailnews.display.prefer_plaintext", values[value][0]);
        gPrefBranch.setIntPref("mailnews.display.html_as", values[value][1]);
        gPrefBranch.setIntPref("mailnews.display.disallow_mime_handlers", values[value][2]);
        ReloadMessage();
    }
}, {
}, {
    commands: function initCommands(dactyl, modules, window) {
        commands.add(["go[to]"],
            "Select a folder",
            function (args) {
                let count = Math.max(0, args.count - 1);
                let arg = args.literalArg || "Inbox";

                let folder = mail.getFolders(arg, true, true)[count];
                if (!folder)
                    dactyl.echoerr(_("command.goto.folderNotExist", arg));
                else if (dactyl.forceNewTab)
                    MsgOpenNewTabForFolder(folder.URI);
                else
                    SelectFolder(folder.URI);
            },
            {
                argCount: "?",
                completer: function (context) completion.mailFolder(context),
                count: true,
                literal: 0
            });

        commands.add(["m[ail]"],
            "Write a new message",
            function (args) {
                let mailargs = {};
                mailargs.to =          args.join(", ");
                mailargs.subject =     args["-subject"];
                mailargs.bcc =         args["-bcc"] || [];
                mailargs.cc =          args["-cc"] || [];
                mailargs.body =        args["-text"];
                mailargs.attachments = args["-attachment"] || [];

                let addresses = args;
                if (mailargs.bcc)
                    addresses = addresses.concat(mailargs.bcc);
                if (mailargs.cc)
                    addresses = addresses.concat(mailargs.cc);

                // TODO: is there a better way to check for validity?
                if (addresses.some(function (recipient) !(/\S@\S+\.\S/.test(recipient))))
                    return void dactyl.echoerr(_("command.mail.invalidEmailAddress"));

                mail.composeNewMail(mailargs);
            },
            {
                // TODO: completers, validators - whole shebang. Do people actually use this? --djk
                options: [
                    { names: ["-subject", "-s"],     type: CommandOption.STRING, description: "Subject line"},
                    { names: ["-attachment", "-a"],  type: CommandOption.LIST,   description: "List of attachments"},
                    { names: ["-bcc", "-b"],         type: CommandOption.LIST,   description: "Blind Carbon Copy addresses"},
                    { names: ["-cc", "-c"],          type: CommandOption.LIST,   description: "Carbon Copy addresses"},
                    { names: ["-text", "-t"],        type: CommandOption.STRING, description: "Message body"}
                ]
            });

        commands.add(["copy[to]"],
            "Copy selected messages",
            function (args) { mail._moveOrCopy(true, args.literalArg); },
            {
                argCount: "1",
                completer: function (context) completion.mailFolder(context),
                literal: 0
            });

        commands.add(["move[to]"],
            "Move selected messages",
            function (args) { mail._moveOrCopy(false, args.literalArg); },
            {
                argCount: "1",
                completer: function (context) completion.mailFolder(context),
                literal: 0
            });

        commands.add(["empty[trash]"],
            "Empty trash of the current account",
            function () { window.goDoCommand("cmd_emptyTrash"); },
            { argCount: "0" });

        commands.add(["get[messages]"],
            "Check for new messages",
            function (args) mail.getNewMessages(!args.bang),
            {
                argCount: "0",
                bang: true,
            });
    },
    completion: function initCompletion(dactyl, modules, window) {
        completion.mailFolder = function mailFolder(context) {
            let folders = mail.getFolders(context.filter);
            context.anchored = false;
            context.quote = false;
            context.completions = folders.map(function (folder)
                    [folder.server.prettyName + ": " + folder.name,
                     "Unread: " + folder.getNumUnread(false)]);
        };
    },
    mappings: function initMappings(dactyl, modules, window) {
        var myModes = config.mailModes;

        mappings.add(myModes, ["<Return>", "i"],
            "Inspect (focus) message",
            function () { content.focus(); });

        mappings.add(myModes, ["I"],
            "Open the message in new tab",
            function () {
                if (gDBView && gDBView.selection.count < 1)
                    return void dactyl.beep();

                MsgOpenNewTabForMessage();
            });

        mappings.add(myModes, ["<Space>"],
            "Scroll message or select next unread one",
            function () Events.PASS);

        mappings.add(myModes, ["t"],
            "Select thread",
            function () { gDBView.ExpandAndSelectThreadByIndex(GetThreadTree().currentIndex, false); });

        mappings.add(myModes, ["d", "<Del>"],
            "Move mail to Trash folder",
            function () { window.goDoCommand("cmd_delete"); });

        mappings.add(myModes, ["j", "<Right>"],
            "Select next message",
            function (args) { mail.selectMessage(function (msg) true, false, false, false, args.count); },
            { count: true });

        mappings.add(myModes, ["gj"],
            "Select next message, including closed threads",
            function (args) { mail.selectMessage(function (msg) true, false, true, false, args.count); },
            { count: true });

        mappings.add(myModes, ["J", "<Tab>"],
            "Select next unread message",
            function (args) { mail.selectMessage(function (msg) !msg.isRead, true, true, false, args.count); },
            { count: true });

        mappings.add(myModes, ["k", "<Left>"],
            "Select previous message",
            function (args) { mail.selectMessage(function (msg) true, false, false, true, args.count); },
            { count: true });

        mappings.add(myModes, ["gk"],
            "Select previous message",
            function (args) { mail.selectMessage(function (msg) true, false, true, true, args.count); },
            { count: true });

        mappings.add(myModes, ["K"],
            "Select previous unread message",
            function (args) { mail.selectMessage(function (msg) !msg.isRead, true, true, true, args.count); },
            { count: true });

        mappings.add(myModes, ["*"],
            "Select next message from the same sender",
            function (args) {
                let author = gDBView.hdrForFirstSelectedMessage.mime2DecodedAuthor.toLowerCase();
                mail.selectMessage(function (msg) msg.mime2DecodedAuthor.toLowerCase().indexOf(author) == 0, true, true, false, args.count);
            },
            { count: true });

        mappings.add(myModes, ["#"],
            "Select previous message from the same sender",
            function (args) {
                let author = gDBView.hdrForFirstSelectedMessage.mime2DecodedAuthor.toLowerCase();
                mail.selectMessage(function (msg) msg.mime2DecodedAuthor.toLowerCase().indexOf(author) == 0, true, true, true, args.count);
            },
            { count: true });

        // SENDING MESSAGES
        mappings.add(myModes, ["m"],
            "Compose a new message",
            function () { CommandExMode().open("mail -subject="); });

        mappings.add(myModes, ["M"],
            "Compose a new message to the sender of selected mail",
            function () {
                let to = mail._escapeRecipient(gDBView.hdrForFirstSelectedMessage.mime2DecodedAuthor);
                CommandExMode().open("mail " + to + " -subject=");
            });

        mappings.add(myModes, ["r"],
            "Reply to sender",
            function () { window.goDoCommand("cmd_reply"); });

        mappings.add(myModes, ["R"],
            "Reply to all",
            function () { window.goDoCommand("cmd_replyall"); });

        mappings.add(myModes, ["f"],
            "Forward message",
            function () { window.goDoCommand("cmd_forward"); });

        mappings.add(myModes, ["F"],
            "Forward message inline",
            function () { window.goDoCommand("cmd_forwardInline"); });

        // SCROLLING
        mappings.add(myModes, ["<Down>"],
            "Scroll message down",
            function (args) { buffer.scrollLines(Math.max(args.count, 1)); },
            { count: true });

        mappings.add(myModes, ["<Up>"],
            "Scroll message up",
            function (args) { buffer.scrollLines(-Math.max(args.count, 1)); },
            { count: true });

        mappings.add([modes.MESSAGE], ["<Left>"],
            "Select previous message",
            function (args) { mail.selectMessage(function (msg) true, false, false, true, args.count); },
            { count: true });

        mappings.add([modes.MESSAGE], ["<Right>"],
            "Select next message",
            function (args) { mail.selectMessage(function (msg) true, false, false, false, args.count); },
            { count: true });

        // UNDO/REDO
        mappings.add(myModes, ["u"],
            "Undo",
            function () {
                if (messenger.canUndo())
                    messenger.undo(msgWindow);
                else
                    dactyl.beep();
            });
        mappings.add(myModes, ["<C-r>"],
            "Redo",
            function () {
                if (messenger.canRedo())
                    messenger.redo(msgWindow);
                else
                    dactyl.beep();
            });

        // GETTING MAIL
        mappings.add(myModes, ["gm"],
            "Get new messages",
            function () { mail.getNewMessages(); });

        mappings.add(myModes, ["gM"],
            "Get new messages for current account only",
            function () { mail.getNewMessages(true); });

        // MOVING MAIL
        mappings.add(myModes, ["c"],
            "Change folders",
            function () { CommandExMode().open("goto "); });

        mappings.add(myModes, ["s"],
            "Move selected messages",
            function () { CommandExMode().open("moveto "); });

        mappings.add(myModes, ["S"],
            "Copy selected messages",
            function () { CommandExMode().open("copyto "); });

        mappings.add(myModes, ["<C-s>"],
            "Archive message",
            function () { mail._moveOrCopy(false, options["archivefolder"]); });

        mappings.add(myModes, ["]s"],
            "Select next starred message",
            function (args) { mail.selectMessage(function (msg) msg.isFlagged, true, true, false, args.count); },
            { count: true });

        mappings.add(myModes, ["[s"],
            "Select previous starred message",
            function (args) { mail.selectMessage(function (msg) msg.isFlagged, true, true, true, args.count); },
            { count: true });

        mappings.add(myModes, ["]a"],
            "Select next message with an attachment",
            function (args) { mail.selectMessage(function (msg) gDBView.db.HasAttachments(msg.messageKey), true, true, false, args.count); },
            { count: true });

        mappings.add(myModes, ["[a"],
            "Select previous message with an attachment",
            function (args) { mail.selectMessage(function (msg) gDBView.db.HasAttachments(msg.messageKey), true, true, true, args.count); },
            { count: true });

        // FOLDER SWITCHING
        mappings.add(myModes, ["gi"],
            "Go to inbox",
            function (args) {
                let folder = mail.getFolders("Inbox", false, true)[(args.count > 0) ? (args.count - 1) : 0];
                if (folder)
                    SelectFolder(folder.URI);
                else
                    dactyl.beep();
            },
            { count: true });

        mappings.add(myModes, ["<C-n>"],
            "Select next folder",
            function (args) {
                let newPos = mail._getCurrentFolderIndex() + Math.max(1, args.count);
                if (newPos >= gFolderTreeView.rowCount) {
                    newPos = newPos % gFolderTreeView.rowCount;
                    commandline.echo(_("finder.atBottom"), commandline.HL_WARNINGMSG, commandline.APPEND_TO_MESSAGES);
                }
                gFolderTreeView.selection.timedSelect(newPos, 500);
            },
            { count: true });

        mappings.add(myModes, ["<C-N>"],
            "Go to next mailbox with unread messages",
            function (args) {
                mail._selectUnreadFolder(false, args.count);
            },
            { count: true });

        mappings.add(myModes, ["<C-p>"],
            "Select previous folder",
            function (args) {
                let newPos = mail._getCurrentFolderIndex() - Math.max(1, args.count);
                if (newPos < 0) {
                    newPos = (newPos % gFolderTreeView.rowCount) + gFolderTreeView.rowCount;
                    commandline.echo(_("finder.atTop"), commandline.HL_WARNINGMSG, commandline.APPEND_TO_MESSAGES);
                }
                gFolderTreeView.selection.timedSelect(newPos, 500);
            },
            { count: true });

        mappings.add(myModes, ["<C-P>"],
            "Go to previous mailbox with unread messages",
            function (args) {
                mail._selectUnreadFolder(true, args.count);
            },
            { count: true });

        // THREADING
        mappings.add(myModes, ["za"],
            "Toggle thread collapsed/expanded",
            function () { if (!mail.expandThread()) mail.collapseThread(); });

        mappings.add(myModes, ["zc"],
            "Collapse thread",
            function () { mail.collapseThread(); });

        mappings.add(myModes, ["zo"],
            "Open thread",
            function () { mail.expandThread(); });

        mappings.add(myModes, ["zr", "zR"],
            "Expand all threads",
            function () { window.goDoCommand("cmd_expandAllThreads"); });

        mappings.add(myModes, ["zm", "zM"],
            "Collapse all threads",
            function () { window.goDoCommand("cmd_collapseAllThreads"); });

        mappings.add(myModes, ["<C-i>"],
            "Go forward",
            function ({ count }) { if (count < 1) count = 1; while (count--) GoNextMessage(nsMsgNavigationType.forward, true); },
            { count: true });

        mappings.add(myModes, ["<C-o>"],
            "Go back",
            function ({ count }) { if (count < 1) count = 1; while (count--) GoNextMessage(nsMsgNavigationType.back, true); },
            { count: true });

        mappings.add(myModes, ["gg"],
            "Select first message",
            function ({ count }) { if (count < 1) count = 1; while (count--) GoNextMessage(nsMsgNavigationType.firstMessage, true); },
            { count: true });

        mappings.add(myModes, ["G"],
            "Select last message",
            function ({ count }) { if (count < 1) count = 1; while (count--) GoNextMessage(nsMsgNavigationType.lastMessage, false); },
            { count: true });

        // tagging messages
        mappings.add(myModes, ["l"],
            "Label message",
            function (arg) {
                if (!GetSelectedMessages())
                    return void dactyl.beep();

                switch (arg) {
                    case "r": MsgMarkMsgAsRead(); break;
                    case "s": MsgMarkAsFlagged(); break;
                    case "i": ToggleMessageTagKey(1); break; // Important
                    case "w": ToggleMessageTagKey(2); break; // Work
                    case "p": ToggleMessageTagKey(3); break; // Personal
                    case "t": ToggleMessageTagKey(4); break; // TODO
                    case "l": ToggleMessageTagKey(5); break; // Later
                    default:  dactyl.beep();
                }
            },
            {
                arg: true
            });

        // TODO: change binding?
        mappings.add(myModes, ["T"],
            "Mark current folder as read",
            function () {
                if (mail.currentFolder.isServer)
                    return dactyl.beep();

                mail.currentFolder.markAllMessagesRead(msgWindow);
            });

        mappings.add(myModes, ["<C-t>"],
            "Mark all messages as read",
            function () {
                mail.getFolders("", false).forEach(function (folder) { folder.markAllMessagesRead(msgWindow); });
            });

        // DISPLAY OPTIONS
        mappings.add(myModes, ["h"],
            "Toggle displayed headers",
            function () {
                let value = gPrefBranch.getIntPref("mail.show_headers", 2);
                gPrefBranch.setIntPref("mail.show_headers", value == 2 ? 1 : 2);
                ReloadMessage();
            });

        mappings.add(myModes, ["x"],
            "Toggle HTML message display",
            function () {
                let wantHtml = (gPrefBranch.getIntPref("mailnews.display.html_as", 1) == 1);
                mail.setHTML(wantHtml ? 1 : 0);
            });

        // YANKING TEXT
        mappings.add(myModes, ["Y"],
            "Yank subject",
            function () {
                try {
                    let subject = gDBView.hdrForFirstSelectedMessage.mime2DecodedSubject;
                    dactyl.clipboardWrite(subject, true);
                }
                catch (e) { dactyl.beep(); }
            });

        mappings.add(myModes, ["y"],
            "Yank sender or feed URL",
            function () {
                try {
                    if (mail.currentAccount.server.type == "rss")
                        dactyl.clipboardWrite(mail._getRSSUrl(), true);
                    else
                        dactyl.clipboardWrite(gDBView.hdrForFirstSelectedMessage.mime2DecodedAuthor, true);
                }
                catch (e) { dactyl.beep(); }
            });

        // RSS specific mappings
        mappings.add(myModes, ["p"],
            "Open RSS message in browser",
            function () {
                try {
                    if (mail.currentAccount.server.type == "rss")
                        messenger.launchExternalURL(mail._getRSSUrl());
                    // TODO: what to do for non-rss message?
                }
                catch (e) {
                    dactyl.beep();
                }
            });
    },
    services: function initServices(dactyl, modules, window) {
        services.add("smtp", "@mozilla.org/messengercompose/smtp;1", Ci.nsISmtpService);
        services.add("compose", "@mozilla.org/messengercompose;1", "nsIMsgComposeService");
    },
    modes: function initModes(dactyl, modules, window) {
        modes.addMode("MESSAGE", {
            char: "m",
            description: "Active the message is focused",
            bases: [modes.COMMAND]
        });
    },
    options: function initOptions(dactyl, modules, window) {
        // FIXME: why does this default to "Archive", I don't have one? The default
        // value won't validate now. mst please fix. --djk
        options.add(["archivefolder"],
            "Set the archive folder",
            "string", "Archive",
            {
                completer: function (context) completion.mailFolder(context)
            });

        // TODO: generate the possible values dynamically from the menu
        options.add(["layout"],
            "Set the layout of the mail window",
            "string", "inherit",
            {
                setter: function (value) {
                    switch (value) {
                        case "classic":  ChangeMailLayout(0); break;
                        case "wide":     ChangeMailLayout(1); break;
                        case "vertical": ChangeMailLayout(2); break;
                        // case "inherit" just does nothing
                    }

                    return value;
                },
                completer: function (context) [
                    ["inherit",  "Default View"], // FIXME: correct description?
                    ["classic",  "Classic View"],
                    ["wide",     "Wide View"],
                    ["vertical", "Vertical View"]
                ]
            });

        options.add(["smtpserver", "smtp"],
            "Set the default SMTP server",
            "string", services.smtp.defaultServer.key, // TODO: how should we handle these persistent external defaults - "inherit" or null?
            {
                getter: function () services.smtp.defaultServer.key,
                setter: function (value) {
                    let server = mail.smtpServers.filter(function (s) s.key == value)[0];
                    services.smtp.defaultServer = server;
                    return value;
                },
                completer: function (context) [[s.key, s.serverURI] for ([, s] in Iterator(mail.smtpServers))]
            });

        /*options.add(["threads"],
            "Use threading to group messages",
            "boolean", true,
            {
                setter: function (value) {
                    if (value)
                        MsgSortThreaded();
                    else
                        MsgSortUnthreaded();

                    return value;
                }
            });*/
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
