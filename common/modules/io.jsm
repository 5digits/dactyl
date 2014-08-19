// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2012 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2014 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

try {

defineModule("io", {
    exports: ["IO", "io"],
    require: ["services"]
});

lazyRequire("config", ["config"]);
lazyRequire("contexts", ["Contexts", "contexts"]);
lazyRequire("promises", ["Promise"]);
lazyRequire("storage", ["File", "storage"]);
lazyRequire("styles", ["styles"]);
lazyRequire("template", ["template"]);

// TODO: why are we passing around strings rather than file objects?
/**
 * Provides a basic interface to common system I/O operations.
 * @instance io
 */
var IO = Module("io", {
    init: function init() {
        this._processDir = services.directory.get("CurWorkD", Ci.nsIFile);
        this._cwd = this._processDir.path;
        this._oldcwd = null;
        lazyRequire("config", ["config"], this);
    },

    Local: function Local(dactyl, modules, window) let ({ io, plugins } = modules) ({

        init: function init() {
            this.config = modules.config;
            this._processDir = services.directory.get("CurWorkD", Ci.nsIFile);
            this._cwd = this._processDir.path;
            this._oldcwd = null;

            this._lastRunCommand = ""; // updated whenever the users runs a command with :!
            this._scriptNames = RealSet();
        },

        CommandFileMode: Class("CommandFileMode", modules.CommandMode, {
            init: function init(prompt, params) {
                init.supercall(this);
                this.prompt = isArray(prompt) ? prompt : ["Question", prompt];
                update(this, params);
            },

            historyKey: "file",

            get mode() modules.modes.FILE_INPUT,

            complete: function (context) {
                if (this.completer)
                    this.completer(context);

                context = context.fork("files", 0);
                modules.completion.file(context);
                context.filters = context.filters.concat(this.filters || []);
            }
        }),

        /**
         * Returns all directories named *name* in 'runtimepath'.
         *
         * @param {string} name
         * @returns {nsIFile[])
         */
        getRuntimeDirectories: function getRuntimeDirectories(name) {
            return modules.options.get("runtimepath").files
                .map(dir => dir.child(name))
                .filter(dir => (dir.exists() && dir.isDirectory() && dir.isReadable()));
        },

        // FIXME: multiple paths?
        /**
         * Sources files found in 'runtimepath'. For each relative path in *paths*
         * each directory in 'runtimepath' is searched and if a matching file is
         * found it is sourced. Only the first file found (per specified path) is
         * sourced unless *all* is specified, then all found files are sourced.
         *
         * @param {[string]} paths An array of relative paths to source.
         * @param {boolean} all Whether all found files should be sourced.
         */
        sourceFromRuntimePath: function sourceFromRuntimePath(paths, all) {
            let dirs = modules.options.get("runtimepath").files;
            let found = null;

            dactyl.echomsg(_("io.searchingFor", paths.join(" ").quote(), modules.options.get("runtimepath").stringValue), 2);

        outer:
            for (let dir in values(dirs)) {
                for (let [, path] in Iterator(paths)) {
                    let file = dir.child(path);

                    dactyl.echomsg(_("io.searchingFor", file.path.quote()), 3);

                    if (file.exists() && file.isFile() && file.isReadable()) {
                        found = io.source(file.path, false) || true;

                        if (!all)
                            break outer;
                    }
                }
            }

            if (!found)
                dactyl.echomsg(_("io.notInRTP", paths.join(" ").quote()), 1);

            return found;
        },

        /**
         * Reads Ex commands, JavaScript or CSS from *filename*.
         *
         * @param {string} filename The name of the file to source.
         * @param {object} params Extra parameters:
         *      group:  The group in which to execute commands.
         *      silent: Whether errors should not be reported.
         */
        source: function source(filename, params) {
            const { contexts } = modules;
            defineModule.loadLog.push("sourcing " + filename);

            if (!isObject(params))
                params = { silent: params };

            let time = Date.now();
            return contexts.withContext(null, function () {
                try {
                    var file = util.getFile(filename) || io.File(filename);

                    if (!file.exists() || !file.isReadable() || file.isDirectory()) {
                        if (!params.silent)
                            dactyl.echoerr(_("io.notReadable", filename.quote()));
                        return;
                    }

                    dactyl.echomsg(_("io.sourcing", filename.quote()), 2);

                    let uri = file.URI;

                    let sourceJSM = function sourceJSM() {
                        context = contexts.Module(uri);
                        dactyl.triggerObserver("io.source", context, file, file.lastModifiedTime);
                    };

                    if (/\.jsm$/.test(filename))
                        sourceJSM();
                    else if (/\.js$/.test(filename)) {
                        try {
                            var context = contexts.Script(file, params.group);
                            if (this._scriptNames.has(file.path))
                                util.flushCache();

                            dactyl.loadScript(uri.spec, context);
                            dactyl.triggerObserver("io.source", context, file, file.lastModifiedTime);
                        }
                        catch (e) {
                            if (e == Contexts) { // Hack;
                                context.unload();
                                sourceJSM();
                            }
                            else {
                                if (e instanceof Finished)
                                    return;
                                if (e.fileName && !(e instanceof FailedAssertion))
                                    try {
                                        e.fileName = util.fixURI(e.fileName);
                                        if (e.fileName == uri.spec)
                                            e.fileName = filename;
                                        e.echoerr = [e.fileName, ":", e.lineNumber, ": ", e].join("");
                                    }
                                    catch (e) {}
                                throw e;
                            }
                        }
                    }
                    else if (/\.css$/.test(filename))
                        styles.registerSheet(uri.spec, false, true);
                    else {
                        context = contexts.Context(file, params.group);
                        modules.commands.execute(file.read(), null, params.silent,
                                                 null, {
                            context: context,
                            file: file.path,
                            group: context.GROUP,
                            line: 1
                        });
                        dactyl.triggerObserver("io.source", context, file, file.lastModifiedTime);
                    }

                    this._scriptNames.add(file.path);

                    dactyl.echomsg(_("io.sourcingEnd", filename.quote()), 2);
                    dactyl.log(_("dactyl.sourced", filename), 3);

                    return context;
                }
                catch (e) {
                    util.reportError(e);
                    let message = _("io.sourcingError", e.echoerr || (file ? file.path : filename) + ": " + e);
                    if (!params.silent)
                        dactyl.echoerr(message);
                }
                finally {
                    defineModule.loadLog.push("done sourcing " + filename + ": " + (Date.now() - time) + "ms");
                }
            }, this);
        }
    }),

    charsets: Class.Memoize(function () {
        const BASE = "@mozilla.org/intl/unicode/decoder;1?charset=";
        return [k.slice(BASE.length)
                for (k of Object.keys(Cc))
                if (k.startsWith(BASE))];
    }),

    charsetBundle: Class.Memoize(
        () => services.stringBundle.createBundle("chrome://global/locale/charsetTitles.properties")),

    charsetTitle: function charsetTitle(charset, default_=charset) {
        try {
            return this.charsetBundle.GetStringFromName(charset + ".title");
        }
        catch (e) {}
        return default_;
    },

    validateCharset: function validateCharset(charset) {
        new TextDecoder(charset);
    },

    // TODO: there seems to be no way, short of a new component, to change
    // the process's CWD - see https://bugzilla.mozilla.org/show_bug.cgi?id=280953
    /**
     * Returns the current working directory.
     *
     * It's not possible to change the real CWD of the process so this
     * state is maintained internally. External commands run via
     * {@link #system} are executed in this directory.
     *
     * @returns {nsIFile}
     */
    get cwd() {
        let dir = File(this._cwd);

        // NOTE: the directory could have been deleted underneath us so
        // fallback to the process's CWD
        if (dir.exists() && dir.isDirectory())
            return dir;
        else
            return this._processDir.clone();
    },

    /**
     * Sets the current working directory.
     *
     * @param {File|string} newDir The new CWD. This may be a relative or
     *     absolute path and is expanded by {@link #expandPath}.
     *     @optional
     *     @default = "~"
     */
    set cwd(newDir = "~") {
        newDir = newDir.path || newDir;

        if (newDir == "-") {
            util.assert(this._oldcwd != null, _("io.noPrevDir"));
            [this._cwd, this._oldcwd] = [this._oldcwd, this.cwd];
        }
        else {
            let dir = io.File(newDir);
            util.assert(dir.exists() && dir.isDirectory(), _("io.noSuchDir", dir.path.quote()));
            dir.normalize();
            [this._cwd, this._oldcwd] = [dir.path, this.cwd];
        }
        return this.cwd;
    },

    /**
     * @property {function} File class.
     * @final
     */
    File: Class.Memoize(function () let (io = this)
        Class("File", File, {
            init: function init(path, checkCWD=true)
                init.supercall(this, path, checkCWD && io.cwd)
        })),

    /**
     * @property {Object} The current file sourcing context. As a file is
     *     being sourced the 'file' and 'line' properties of this context
     *     object are updated appropriately.
     */
    sourcing: null,

    expandPath: deprecated("File.expandPath", function expandPath() File.expandPath.apply(File, arguments)),

    /**
     * Returns the first user RC file found in *dir*.
     *
     * @param {File|string} dir The directory to search.
     * @param {boolean} always When true, return a path whether
     *     the file exists or not.
     * @default $HOME.
     * @returns {nsIFile} The RC file or null if none is found.
     */
    getRCFile: function getRCFile(dir, always) {
        dir = this.File(dir || "~");

        let rcFile1 = dir.child("." + config.name + "rc");
        let rcFile2 = dir.child("_" + config.name + "rc");

        if (config.OS.isWindows)
            [rcFile1, rcFile2] = [rcFile2, rcFile1];

        if (rcFile1.exists() && rcFile1.isFile())
            return rcFile1;
        else if (rcFile2.exists() && rcFile2.isFile())
            return rcFile2;
        else if (always)
            return rcFile1;
        return null;
    },

    /**
     * Returns a temporary file.
     *
     * @param {string} ext The filename extension.
     *     @default "txt"
     * @param {string} label A metadata string appended to the filename. Useful
     *     for identifying the file, beyond its extension, to external
     *     applications.
     *     @default ""
     * @returns {File}
     */
    createTempFile: function createTempFile(ext="txt", label="") {
        let file = services.directory.get("TmpD", Ci.nsIFile);
        file.append(config.name + label + "." + ext);
        file.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, 0o666);

        services.externalApp.deleteTemporaryFileOnExit(file);

        return File(file);
    },

    /**
     * Determines whether the given URL string resolves to a JAR URL and
     * returns the matching nsIJARURI object if it does.
     *
     * @param {string} url The URL to check.
     * @returns {nsIJARURI|null}
     */
    isJarURL: function isJarURL(url) {
        try {
            let uri = util.newURI(url);
            if (uri instanceof Ci.nsIJARURI)
                return uri;

            let channel = services.io.newChannelFromURI(uri);
            try { channel.cancel(Cr.NS_BINDING_ABORTED); } catch (e) {}
            if (channel instanceof Ci.nsIJARChannel)
                return channel.URI.QueryInterface(Ci.nsIJARURI);
        }
        catch (e) {}
        return null;
    },

    /**
     * Returns a list of the contents of the given JAR file which are
     * children of the given path.
     *
     * @param {nsIURI|string} file The URI of the JAR file to list.
     * @param {string} path The prefix path to search.
     */
    listJar: function listJar(file, path) {
        file = util.getFile(file);
        if (file && file.exists() && file.isFile() && file.isReadable()) {
            // let jar = services.zipReader.getZip(file); Crashes.
            let jar = services.ZipReader(file.file);
            try {
                let filter = RegExp("^" + util.regexp.escape(decodeURI(path))
                                    + "[^/]*/?$");

                for (let entry in iter(jar.findEntries("*")))
                    if (filter.test(entry))
                        yield entry;
            }
            finally {
                if (jar)
                    jar.close();
            }
        }
    },

    readHeredoc: function readHeredoc(end) {
        return "";
    },

    /**
     * Searches for the given executable file in the system executable
     * file paths as specified by the PATH environment variable.
     *
     * On Windows, if the unadorned filename cannot be found, the
     * extensions in the semicolon-separated list in the PATHSEP
     * environment variable are successively appended to the original
     * name and searched for in turn.
     *
     * @param {string} bin The name of the executable to find.
     * @returns {File|null}
     */
    pathSearch: function pathSearch(bin) {
        if (bin instanceof File || File.isAbsolutePath(bin))
            return this.File(bin);

        let dirs = services.environment.get("PATH")
                           .split(config.OS.pathListSep);
        // Windows tries the CWD first TODO: desirable?
        if (config.OS.isWindows)
            dirs = [io.cwd].concat(dirs);

        for (let [, dir] in Iterator(dirs))
            try {
                dir = this.File(dir, true);

                let file = dir.child(bin);
                if (file.exists() && file.isFile() && file.isExecutable())
                    return file;

                // TODO: couldn't we just palm this off to the start command?
                // automatically try to add the executable path extensions on windows
                if (config.OS.isWindows) {
                    let extensions = services.environment.get("PATHEXT").split(";");
                    for (let [, extension] in Iterator(extensions)) {
                        file = dir.child(bin + extension);
                        if (file.exists())
                            return file;
                    }
                }
            }
            catch (e) {}
        return null;
    },

    /**
     * Runs an external program.
     *
     * @param {File|string} program The program to run.
     * @param {[string]} args An array of arguments to pass to *program*.
     */
    run: function run(program, args, blocking, self) {
        args = args || [];

        let file = this.pathSearch(program);

        if (!file || !file.exists()) {
            util.dactyl.echoerr(_("io.noCommand", program));
            if (callable(blocking))
                util.trapErrors(blocking);
            return -1;
        }

        let process = services.Process(file.file);
        process.run(false, args.map(String), args.length);

        let deferred = Promise.defer();

        if (callable(blocking))
            // Deprecated.
            deferred.promise.then(blocking);
        else if (blocking) {
            // Deprecated?
            while (process.isRunning)
                util.threadYield(false, true);
            return process.exitValue;
        }

        let timer = services.Timer(
            function () {
                if (!process.isRunning) {
                    timer.cancel();
                    deferred.resolve(process.exitValue);
                }
            },
            100, services.Timer.TYPE_REPEATING_SLACK);

        return deferred.promise;
    },

    // TODO: when https://bugzilla.mozilla.org/show_bug.cgi?id=68702 is
    // fixed use that instead of a tmpfile
    /**
     * Runs *command* in a subshell and returns the output. The shell used is
     * that specified by the 'shell' option.
     *
     * @param {string|[string]} command The command to run. This can be a shell
     *      command string or an array of strings (a command and arguments)
     *      which will be escaped and concatenated.
     * @param {string} input Any input to be provided to the command on stdin.
     * @param {function(object)} callback A callback to be called when
     *      the command completes. @optional
     * @returns {object|null}
     */
    system: function system(command, input, callback) {
        util.dactyl.echomsg(_("io.callingShell", command), 4);

        let { shellEscape } = util.bound;

        return this.withTempFiles(function (stdin, stdout, cmd) {
            if (input instanceof File)
                stdin = input;
            else if (input)
                stdin.write(input);

            function result(status, output) ({
                __noSuchMethod__: function (meth, args) this.output[meth].apply(this.output, args),
                valueOf: function () this.output,
                output: output.replace(/^(.*)\n$/, "$1"),
                returnValue: status,
                toString: function () this.output
            });

            function async(status) {
                let output = stdout.read();
                for (let f of [stdin, stdout, cmd])
                    if (f.exists())
                        f.remove(false);
                callback(result(status, output));
            }

            let shell = io.pathSearch(storage["options"].get("shell").value);
            let shcf = storage["options"].get("shellcmdflag").value;
            util.assert(shell, _("error.invalid", "'shell'"));

            if (isArray(command))
                command = command.map(shellEscape).join(" ");

            // TODO: implement 'shellredir'
            if (config.OS.isWindows && !/sh/.test(shell.leafName)) {
                command = "cd /D " + this.cwd.path + " && " + command + " > " + stdout.path + " 2>&1" + " < " + stdin.path;
                var res = this.run(shell, shcf.split(/\s+/).concat(command), callback ? async : true);
            }
            else {
                cmd.write("cd " + shellEscape(this.cwd.path) + "\n" +
                        ["exec", ">" + shellEscape(stdout.path), "2>&1", "<" + shellEscape(stdin.path),
                         shellEscape(shell.path), shcf, shellEscape(command)].join(" "));
                res = this.run("/bin/sh", ["-e", cmd.path], callback ? async : true);
            }

            return callback ? true : result(res, stdout.read());
        }, this, true);
    },

    /**
     * Creates a temporary file context for executing external commands.
     * *func* is called with a temp file, created with {@link #createTempFile},
     * for each explicit argument. Ensures that all files are removed when
     * *func* returns.
     *
     * @param {function} func The function to execute.
     * @param {Object} self The 'this' object used when executing func.
     * @returns {boolean} false if temp files couldn't be created,
     *     otherwise, the return value of *func*.
     */
    withTempFiles: function withTempFiles(func, self, checked, ext, label) {
        let args = array(util.range(0, func.length))
                    .map(bind("createTempFile", this, ext, label)).array;
        try {
            if (!args.every(util.identity))
                return false;
            var res = func.apply(self || this, args);
        }
        finally {
            if (!checked || res !== true)
                args.forEach(f => { f.remove(false); });
        }
        return res;
    }
}, {
    /**
     * @property {string} The value of the $PENTADACTYL_RUNTIME environment
     *     variable.
     */
    get runtimePath() {
        const rtpvar = config.idName + "_RUNTIME";
        let rtp = services.environment.get(rtpvar);
        if (!rtp) {
            rtp = "~/" + (config.OS.isWindows ? "" : ".") + config.name;
            services.environment.set(rtpvar, rtp);
        }
        return rtp;
    },

    /**
     * @property {string} The current platform's path separator.
     */
    PATH_SEP: deprecated("File.PATH_SEP", { get: function PATH_SEP() File.PATH_SEP })
}, {
    commands: function initCommands(dactyl, modules, window) {
        const { commands, completion, io } = modules;

        commands.add(["cd", "chd[ir]"],
            "Change the current directory",
            function (args) {
                let arg = args[0];

                if (!arg)
                    arg = "~";

                arg = File.expandPath(arg);

                // go directly to an absolute path or look for a relative path
                // match in 'cdpath'
                if (File.isAbsolutePath(arg)) {
                    io.cwd = arg;
                    dactyl.echomsg(io.cwd.path);
                }
                else {
                    let dirs = modules.options.get("cdpath").files;
                    for (let dir in values(dirs)) {
                        dir = dir.child(arg);

                        if (dir.exists() && dir.isDirectory() && dir.isReadable()) {
                            io.cwd = dir;
                            dactyl.echomsg(io.cwd.path);
                            return;
                        }
                    }

                    dactyl.echoerr(_("io.noSuchDir", arg.quote()));
                    dactyl.echoerr(_("io.commandFailed"));
                }
            }, {
                argCount: "?",
                completer: function (context) completion.directory(context, true),
                literal: 0
            });

        commands.add(["pw[d]"],
            "Print the current directory name",
            function () { dactyl.echomsg(io.cwd.path); },
            { argCount: "0" });

        commands.add([config.name.replace(/(.)(.*)/, "mk$1[$2rc]")],
            "Write current key mappings and changed options to the config file",
            function (args) {
                dactyl.assert(args.length <= 1, _("io.oneFileAllowed"));

                let file = io.File(args[0] || io.getRCFile(null, true));

                dactyl.assert(!file.exists() || args.bang, _("io.exists", file.path.quote()));

                // TODO: Use a set/specifiable list here:
                let lines = [cmd.serialize().map(commands.commandToString, cmd) for (cmd in commands.iterator()) if (cmd.serialize)];
                lines = array.flatten(lines);

                lines.unshift('"' + config.version + "\n");
                lines.push("\n\" vim: set ft=" + config.name + ":");

                try {
                    file.write(lines.join("\n").concat("\n"));
                    dactyl.echomsg(_("io.writing", file.path.quote()), 2);
                }
                catch (e) {
                    dactyl.echoerr(_("io.notWriteable", file.path.quote()));
                    dactyl.log(_("error.notWriteable", file.path, e.message)); // XXX
                }
            }, {
                argCount: "*", // FIXME: should be "?" but kludged for proper error message
                bang: true,
                completer: function (context) completion.file(context, true)
            });

        commands.add(["mkv[imruntime]"],
            "Create and install Vim runtime files for " + config.appName,
            function (args) {
                dactyl.assert(args.length <= 1, _("io.oneFileAllowed"));

                if (args.length) {
                    var rtDir = io.File(args[0]);
                    dactyl.assert(rtDir.exists(), _("io.noSuchDir", rtDir.path.quote()));
                }
                else
                    rtDir = io.File(config.OS.isWindows ? "~/vimfiles/" : "~/.vim/");

                dactyl.assert(!rtDir.exists() || rtDir.isDirectory(), _("io.eNotDir", rtDir.path.quote()));

                let rtItems = { ftdetect: {}, ftplugin: {}, syntax: {} };

                // require bang if any of the paths exist
                for (let [type, item] in iter(rtItems)) {
                    let file = io.File(rtDir).child(type, config.name + ".vim");
                    dactyl.assert(!file.exists() || args.bang, _("io.exists", file.path.quote()));
                    item.file = file;
                }

                rtItems.ftdetect.template = //{{{
literal(function () /*" Vim filetype detection file
<header>

au BufNewFile,BufRead *<name>rc*,*.<fileext> set filetype=<name>
*/$);//}}}
                rtItems.ftplugin.template = //{{{
literal(function () /*" Vim filetype plugin file
<header>

if exists("b:did_ftplugin")
  finish
endif
let b:did_ftplugin = 1

let s:cpo_save = &cpo
set cpo&vim

let b:undo_ftplugin = "setl com< cms< fo< ofu< | unlet! b:browsefilter"

setlocal comments=:\"
setlocal commentstring=\"%s
setlocal formatoptions-=t formatoptions+=croql
setlocal omnifunc=syntaxcomplete#Complete

if has("gui_win32") && !exists("b:browsefilter")
    let b:browsefilter = "<appname> Config Files (*.<fileext>)\t*.<fileext>\n" .
        \ "All Files (*.*)\t*.*\n"
endif

let &cpo = s:cpo_save
unlet s:cpo_save
*/$);//}}}
                rtItems.syntax.template = //{{{
literal(function () /*" Vim syntax file
<header>

if exists("b:current_syntax")
  finish
endif

let s:cpo_save = &cpo
set cpo&vim

syn include @javascriptTop syntax/javascript.vim
unlet b:current_syntax

syn include @cssTop syntax/css.vim
unlet b:current_syntax

syn match <name>CommandStart "\%(^\s*:\=\)\@<=" nextgroup=<name>Command,<name>AutoCmd

<commands>
    \ contained

syn match <name>Command "!" contained

syn keyword <name>AutoCmd au[tocmd] contained nextgroup=<name>AutoEventList skipwhite

<autocommands>
    \ contained

syn match <name>AutoEventList "\(\a\+,\)*\a\+" contained contains=<name>AutoEvent

syn region <name>Set matchgroup=<name>Command start="\%(^\s*:\=\)\@<=\<\%(setl\%[ocal]\|setg\%[lobal]\|set\=\)\=\>"
    \ end="$" keepend oneline contains=<name>Option,<name>String

<options>
    \ contained nextgroup=pentadactylSetMod

<toggleoptions>
execute 'syn match <name>Option "\<\%(no\|inv\)\=\%(' .
    \ join(s:toggleOptions, '\|') .
    \ '\)\>!\=" contained nextgroup=<name>SetMod'

syn match <name>SetMod "\%(\<[a-z_]\+\)\@<=&" contained

syn region <name>JavaScript start="\%(^\s*\%(javascript\|js\)\s\+\)\@<=" end="$" contains=@javascriptTop keepend oneline
syn region <name>JavaScript matchgroup=<name>JavaScriptDelimiter
    \ start="\%(^\s*\%(javascript\|js\)\s\+\)\@<=<<\s*\z(\h\w*\)"hs=s+2 end="^\z1$" contains=@javascriptTop fold

let s:cssRegionStart = '\%(^\s*sty\%[le]!\=\s\+\%(-\%(n\|name\)\%(\s\+\|=\)\S\+\s\+\)\=[^-]\S\+\s\+\)\@<='
execute 'syn region <name>Css start="' . s:cssRegionStart . '" end="$" contains=@cssTop keepend oneline'
execute 'syn region <name>Css matchgroup=<name>CssDelimiter'
    \ 'start="' . s:cssRegionStart . '<<\s*\z(\h\w*\)"hs=s+2 end="^\z1$" contains=@cssTop fold'

syn match <name>Notation "<[0-9A-Za-z-]\+>"

syn keyword <name>Todo FIXME NOTE TODO XXX contained

syn region <name>String start="\z(["']\)" end="\z1" skip="\\\\\|\\\z1" oneline

syn match <name>Comment +^\s*".*$+ contains=<name>Todo,@Spell

" NOTE: match vim.vim highlighting group names
hi def link <name>AutoCmd               <name>Command
hi def link <name>AutoEvent             Type
hi def link <name>Command               Statement
hi def link <name>JavaScriptDelimiter   Delimiter
hi def link <name>CssDelimiter          Delimiter
hi def link <name>Notation              Special
hi def link <name>Comment               Comment
hi def link <name>Option                PreProc
hi def link <name>SetMod                <name>Option
hi def link <name>String                String
hi def link <name>Todo                  Todo

let b:current_syntax = "<name>"

let &cpo = s:cpo_save
unlet s:cpo_save

" vim: tw=130 et ts=8 sts=4 sw=4:
*/$);//}}}

                const { options } = modules;

                const WIDTH = 80;
                function wrap(prefix, items, sep) {//{{{
                    sep = sep || " ";
                    let width = 0;
                    let lines = [];
                    lines.__defineGetter__("last", function () this[this.length - 1]);

                    for (let item in values(items.array || items)) {
                        if (item.length > width && (!lines.length || lines.last.length > 1)) {
                            lines.push([prefix]);
                            width = WIDTH - prefix.length;
                            prefix = "    \\ ";
                        }
                        width -= item.length + sep.length;
                        lines.last.push(item, sep);
                    }
                    lines.last.pop();
                    return lines.map(l => l.join(""))
                                .join("\n")
                                .replace(/\s+\n/gm, "\n");
                }//}}}

                let params = { //{{{
                    header: ['" Language:    ' + config.appName + ' configuration file',
                             '" Maintainer:  Doug Kearns <dougkearns@gmail.com>',
                             '" Version:     ' + config.version].join("\n"),
                    name: config.name,
                    appname: config.appName,
                    fileext: config.fileExtension,
                    maintainer: "Doug Kearns <dougkearns@gmail.com>",
                    autocommands: wrap("syn keyword " + config.name + "AutoEvent ",
                                       keys(config.autocommands)),
                    commands: wrap("syn keyword " + config.name + "Command ",
                                  array(c.specs for (c in commands.iterator())).flatten()),
                    options: wrap("syn keyword " + config.name + "Option ",
                                  array(o.names for (o in options) if (o.type != "boolean")).flatten()),
                    toggleoptions: wrap("let s:toggleOptions = [",
                                        array(o.realNames for (o in options) if (o.type == "boolean"))
                                            .flatten().map(String.quote),
                                        ", ") + "]"
                }; //}}}

                for (let { file, template } in values(rtItems)) {
                    try {
                        file.write(util.compileMacro(template, true)(params));
                        dactyl.echomsg(_("io.writing", file.path.quote()), 2);
                    }
                    catch (e) {
                        dactyl.echoerr(_("io.notWriteable", file.path.quote()));
                        dactyl.log(_("error.notWriteable", file.path, e.message));
                    }
                }
            }, {
                argCount: "?",
                bang: true,
                completer: function (context) completion.directory(context, true),
                literal: 1
            });

        commands.add(["runt[ime]"],
            "Source the specified file from each directory in 'runtimepath'",
            function (args) { io.sourceFromRuntimePath(args, args.bang); },
            {
                argCount: "+",
                bang: true,
                completer: function (context) completion.runtime(context)
            }
        );

        commands.add(["scrip[tnames]"],
            "List all sourced script names",
            function () {
                let names = [k for (k of io._scriptNames)];
                if (!names.length)
                    dactyl.echomsg(_("command.scriptnames.none"));
                else
                    modules.commandline.commandOutput(
                        template.tabular(["<SNR>", "Filename"], ["text-align: right; padding-right: 1em;"],
                            ([i + 1, file] for ([i, file] in Iterator(names)))));

            },
            { argCount: "0" });

        commands.add(["so[urce]"],
            "Read Ex commands, JavaScript or CSS from a file",
            function (args) {
                if (args.length > 1)
                    dactyl.echoerr(_("io.oneFileAllowed"));
                else
                    io.source(args[0], { silent: args.bang });
            }, {
                argCount: "+", // FIXME: should be "1" but kludged for proper error message
                bang: true,
                completer: function (context) completion.file(context, true)
            });

        commands.add(["!", "run"],
            "Run a command",
            function (args) {
                let arg = args[0] || "";

                // :!! needs to be treated specially as the command parser sets the
                // bang flag but removes the ! from arg
                if (args.bang)
                    arg = "!" + arg;

                // This is an asinine and irritating "feature" when we have searchable
                // command-line history. --Kris
                if (modules.options["banghist"]) {
                    // NOTE: Vim doesn't replace ! preceded by 2 or more backslashes and documents it - desirable?
                    // pass through a raw bang when escaped or substitute the last command

                    // replaceable bang and no previous command?
                    dactyl.assert(!/((^|[^\\])(\\\\)*)!/.test(arg) || io._lastRunCommand,
                        _("command.run.noPrevious"));

                    arg = arg.replace(/(\\)*!/g,
                                      m => (/^\\(\\\\)*!$/.test(m) ? m.replace("\\!", "!")
                                                                   : m.replace("!", io._lastRunCommand)));
                }

                io._lastRunCommand = arg;

                let result = io.system(arg);
                if (result.returnValue != 0)
                    result.output += "\n" + _("io.shellReturn", result.returnValue);

                modules.commandline.command = args.commandName.replace("run", "$& ") + arg;
                modules.commandline.commandOutput(["span", { highlight: "CmdOutput" }, result.output]);

                modules.autocommands.trigger("ShellCmdPost", {});
            }, {
                argCount: "?",
                bang: true,
                // This is abominably slow.
                // completer: function (context) completion.shellCommand(context),
                literal: 0
            });
    },
    completion: function initCompletion(dactyl, modules, window) {
        const { completion, io } = modules;

        completion.charset = function (context) {
            context.anchored = false;
            context.keys = {
                text: util.identity,
                description: charset => io.charsetTitle(charset),
            };
            context.completions = io.charsets;
        };

        completion.directory = function directory(context, full) {
            this.file(context, full);
            context.filters.push(item => item.isdir);
        };

        completion.environment = function environment(context) {
            context.title = ["Environment Variable", "Value"];
            context.generate = () =>
                io.system(config.OS.isWindows ? "set" : "env")
                  .output.split("\n")
                  .filter(line => line.indexOf("=") > 0)
                  .map(line => line.match(/([^=]+)=(.*)/).slice(1));
        };

        completion.file = function file(context, full, dir) {
            if (/^jar:[^!]*$/.test(context.filter))
                context.advance(4);

            // dir == "" is expanded inside readDirectory to the current dir
            function getDir(str) str.match(/^(?:.*[\/\\])?/)[0];
            dir = getDir(dir || context.filter);

            let file = util.getFile(dir);
            if (file && (!file.exists() || !file.isDirectory()))
                file = file.parent;

            if (!full)
                context.advance(dir.length);

            context.title = [full ? "Path" : "Filename", "Type"];
            context.keys = {
                text: !full ? "leafName" : function (f) this.path,
                path: function (f) dir + f.leafName,
                description: function (f) this.isdir ? "Directory" : "File",
                isdir: function (f) f.isDirectory(),
                icon: function (f) this.isdir ? "resource://gre/res/html/folder.png"
                                              : "moz-icon://" + f.leafName
            };
            context.compare = (a, b) => b.isdir - a.isdir || String.localeCompare(a.text, b.text);

            if (modules.options["wildignore"])
                context.filters.push(item => !modules.options.get("wildignore").getKey(item.path));

            // context.background = true;
            context.key = dir;
            let uri = io.isJarURL(dir);
            if (uri)
                context.generate = function generate_jar() {
                    return [
                        {
                              isDirectory: function () s.substr(-1) == "/",
                              leafName: /([^\/]*)\/?$/.exec(s)[1]
                        }
                        for (s in io.listJar(uri.JARFile, getDir(uri.JAREntry)))]
                };
            else
                context.generate = function generate_file() {
                    try {
                        return io.File(file || dir).readDirectory();
                    }
                    catch (e) {}
                    return [];
                };
        };

        completion.runtime = function (context) {
            for (let [, dir] in Iterator(modules.options["runtimepath"]))
                context.fork(dir, 0, this, function (context) {
                    dir = dir.replace("/+$", "") + "/";
                    completion.file(context, true, dir + context.filter);
                    context.title[0] = dir;
                    context.keys.text = function (f) this.path.substr(dir.length);
                });
        };

        completion.shellCommand = function shellCommand(context) {
            context.title = ["Shell Command", "Path"];
            context.generate = function () {
                let dirNames = services.environment.get("PATH").split(config.OS.pathListSep);
                let commands = [];

                for (let [, dirName] in Iterator(dirNames)) {
                    let dir = io.File(dirName);
                    if (dir.exists() && dir.isDirectory())
                        commands.push([[file.leafName, dir.path] for (file in iter(dir.directoryEntries))
                                       if (file.isFile() && file.isExecutable())]);
                }

                return array.flatten(commands);
            };
        };

        completion.addUrlCompleter("file", "Local files", function (context, full) {
            let match = util.regexp(literal(function () /*
                ^
                (?P<prefix>
                    (?P<proto>
                        (?P<scheme> chrome|resource)
                        :\/\/
                    )
                    [^\/]*
                )
                (?P<path> \/[^\/]* )?
                $
            */$), "x").exec(context.filter);
            if (match) {
                if (!match.path) {
                    context.key = match.proto;
                    context.advance(match.proto.length);
                    context.generate = () => config.chromePackages.map(p => [p, match.proto + p + "/"]);
                }
                else if (match.scheme === "chrome") {
                    context.key = match.prefix;
                    context.advance(match.prefix.length + 1);
                    context.generate = function () iter({
                        content: /*L*/"Chrome content",
                        locale: /*L*/"Locale-specific content",
                        skin: /*L*/"Theme-specific content"
                    });
                }
            }
            if (!match || match.scheme === "resource" && match.path)
                if (/^(\.{0,2}|~)\/|^file:/.test(context.filter)
                    || config.OS.isWindows && /^[a-z]:/i.test(context.filter)
                    || util.getFile(context.filter)
                    || io.isJarURL(context.filter))
                    completion.file(context, full);
        });
    },
    javascript: function initJavascript(dactyl, modules, window) {
        modules.JavaScript.setCompleter([File, File.expandPath],
            [function (context, obj, args) {
                context.quote[2] = "";
                modules.completion.file(context, true);
            }]);

    },
    modes: function initModes(dactyl, modules, window) {
        initModes.require("commandline");
        const { modes } = modules;

        modes.addMode("FILE_INPUT", {
            extended: true,
            description: "Active when selecting a file",
            bases: [modes.COMMAND_LINE],
            input: true
        });
    },
    options: function initOptions(dactyl, modules, window) {
        const { completion, options } = modules;

        var shell, shellcmdflag;
        if (config.OS.isWindows) {
            shell = "cmd.exe";
            shellcmdflag = "/c";
        }
        else {
            shell = services.environment.get("SHELL") || "sh";
            shellcmdflag = "-c";
        }

        options.add(["banghist", "bh"],
            "Replace occurrences of ! with the previous command when executing external commands",
            "boolean", false);

        options.add(["fileencoding", "fenc"],
            "The character encoding used when reading and writing files",
            "string", "UTF-8", {
                completer: function (context) completion.charset(context),
                getter: function () File.defaultEncoding,
                setter: function (value) (File.defaultEncoding = value)
            });
        options.add(["cdpath", "cd"],
            "List of directories searched when executing :cd",
            "stringlist", ["."].concat(services.environment.get("CDPATH").split(/[:;]/).filter(util.identity)).join(","),
            {
                get files() this.value.map(path => File(path, modules.io.cwd))
                                .filter(dir => dir.exists()),
                setter: function (value) File.expandPathList(value)
            });

        options.add(["runtimepath", "rtp"],
            "List of directories searched for runtime files",
            "stringlist", IO.runtimePath,
            {
                get files() this.value.map(path => File(path, modules.io.cwd))
                                .filter(dir => dir.exists())
            });

        options.add(["shell", "sh"],
            "Shell to use for executing external commands with :! and :run",
            "string", shell,
            { validator: function (val) io.pathSearch(val) });

        options.add(["shellcmdflag", "shcf"],
            "Flag passed to shell when executing external commands with :! and :run",
            "string", shellcmdflag,
            {
                getter: function (value) {
                    if (this.hasChanged || !config.OS.isWindows)
                        return value;
                    return /sh/.test(options["shell"]) ? "-c" : "/c";
                }
            });
        options["shell"]; // Make sure it's loaded into global storage.
        options["shellcmdflag"];

        options.add(["wildignore", "wig"],
            "List of path name patterns to ignore when completing files and directories",
            "regexplist", "");
    }
});

endModule();

} catch(e){ if (isString(e)) e = Error(e); dump(e.fileName+":"+e.lineNumber+": "+e+"\n" + e.stack); }

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
