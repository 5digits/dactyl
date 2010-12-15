// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2009 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2010 by Kris Maglione <maglione.k@gmail.com>
// Some code based on Venkman
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

/** @scope modules */

plugins.contexts = {};
function Script(file) {
    let self = plugins[file.path];
    if (self) {
        if (self.onUnload)
            self.onUnload();
    }
    else {
        self = { __proto__: plugins };
        plugins[file.path] = self;
        self.NAME = file.leafName.replace(/\..*/, "").replace(/-([a-z])/g, function (m, n1) n1.toUpperCase());
        self.PATH = file.path;
        self.CONTEXT = self;

        // This belongs elsewhere
        if (io.getRuntimeDirectories("plugins").some(
                function (dir) dir.contains(file, false)))
            plugins[self.NAME] = self;
    }
    plugins.contexts[file.path] = self;
    return self;
}

// TODO: why are we passing around strings rather than file objects?
/**
 * Provides a basic interface to common system I/O operations.
 * @instance io
 */
const IO = Module("io", {
    init: function () {
        this._processDir = services.directory.get("CurWorkD", Ci.nsIFile);
        this._cwd = this._processDir.path;
        this._oldcwd = null;

        this._lastRunCommand = ""; // updated whenever the users runs a command with :!
        this._scriptNames = [];

        this.downloadListener = {
            onDownloadStateChange: function (state, download) {
                if (download.state == services.downloadManager.DOWNLOAD_FINISHED) {
                    let url   = download.source.spec;
                    let title = download.displayName;
                    let file  = download.targetFile.path;
                    let size  = download.size;

                    dactyl.echomsg({ domains: [util.getHost(url)], message: "Download of " + title + " to " + file + " finished" },
                                   1, commandline.ACTIVE_WINDOW);
                    autocommands.trigger("DownloadPost", { url: url, title: title, file: file, size: size });
                }
            },
            onStateChange:    function () {},
            onProgressChange: function () {},
            onSecurityChange: function () {}
        };

        services.downloadManager.addListener(this.downloadListener);
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
            return dir.path;
        else
            return this._processDir.path;
    },

    /**
     * Sets the current working directory.
     *
     * @param {string} newDir The new CWD. This may be a relative or
     *     absolute path and is expanded by {@link #expandPath}.
     */
    set cwd(newDir) {
        newDir = newDir || "~";

        if (newDir == "-") {
            dactyl.assert(this._oldcwd != null, "E186: No previous directory");
            [this._cwd, this._oldcwd] = [this._oldcwd, this.cwd];
        }
        else {
            let dir = io.File(newDir);
            dactyl.assert(dir.exists() && dir.isDirectory(), "E344: Can't find directory " + dir.path.quote());
            dir.normalize();
            [this._cwd, this._oldcwd] = [dir.path, this.cwd];
        }
        return this.cwd;
    },

    destroy: function () {
        services.downloadManager.removeListener(this.downloadListener);
        for (let [, plugin] in Iterator(plugins.contexts))
            if (plugin.onUnload)
                plugin.onUnload();
    },

    /**
     * @property {function} File class.
     * @final
     */
    File: Class("File", File, {
        init: function init(path, checkCWD)
            init.supercall(this, path, (arguments.length < 2 || checkCWD) && io.cwd)
    }),

    /**
     * @property {Object} The current file sourcing context. As a file is
     *     being sourced the 'file' and 'line' properties of this context
     *     object are updated appropriately.
     */
    sourcing: null,

    /**
     * Expands "~" and environment variables in *path*.
     *
     * "~" is expanded to to the value of $HOME. On Windows if this is not
     * set then the following are tried in order:
     *   $USERPROFILE
     *   ${HOMDRIVE}$HOMEPATH
     *
     * The variable notation is $VAR (terminated by a non-word character)
     * or ${VAR}. %VAR% is also supported on Windows.
     *
     * @param {string} path The unexpanded path string.
     * @param {boolean} relative Whether the path is relative or absolute.
     * @returns {string}
     */
    expandPath: File.expandPath,

    /**
     * Returns all directories named *name* in 'runtimepath'.
     *
     * @param {string} name
     * @returns {nsIFile[])
     */
    getRuntimeDirectories: function (name) {
        let dirs = options["runtimepath"];

        dirs = dirs.map(function (dir) File.joinPaths(dir, name, this.cwd), this)
                   .filter(function (dir) dir.exists() && dir.isDirectory() && dir.isReadable());
        return dirs;
    },

    /**
     * Returns the first user RC file found in *dir*.
     *
     * @param {string} dir The directory to search.
     * @param {boolean} always When true, return a path whether
     *     the file exists or not.
     * @default $HOME.
     * @returns {nsIFile} The RC file or null if none is found.
     */
    getRCFile: function (dir, always) {
        dir = dir || "~";

        let rcFile1 = File.joinPaths(dir, "." + config.name + "rc", this.cwd);
        let rcFile2 = File.joinPaths(dir, "_" + config.name + "rc", this.cwd);

        if (util.OS.isWindows)
            [rcFile1, rcFile2] = [rcFile2, rcFile1];

        if (rcFile1.exists() && rcFile1.isFile())
            return rcFile1;
        else if (rcFile2.exists() && rcFile2.isFile())
            return rcFile2;
        else if (always)
            return rcFile1;
        return null;
    },

    // TODO: make secure
    /**
     * Creates a temporary file.
     *
     * @returns {File}
     */
    createTempFile: function () {
        let file = services.directory.get("TmpD", Ci.nsIFile);

        file.append(config.tempFile);
        file.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, octal(600));
        Cc["@mozilla.org/uriloader/external-helper-app-service;1"]
            .getService(Ci.nsPIExternalAppLauncher).deleteTemporaryFileOnExit(file);

        return io.File(file);
    },

    isJarURL: function (url) {
        try {
            let uri = util.newURI(url);
            let channel = services.io.newChannelFromURI(uri);
            channel.cancel(Cr.NS_BINDING_ABORTED);
            if (channel instanceof Ci.nsIJARChannel)
                return channel.QueryInterface(Ci.nsIJARChannel);
        }
        catch (e) {}
        return false;
    },

    readHeredoc: function (end) {
        return "";
    },

    /**
     * Runs an external program.
     *
     * @param {string} program The program to run.
     * @param {string[]} args An array of arguments to pass to *program*.
     * @param {boolean} blocking Whether to wait until the process terminates.
     */
    blockingProcesses: [],
    run: function (program, args, blocking) {
        args = args || [];
        blocking = !!blocking;

        let file;

        if (File.isAbsolutePath(program))
            file = io.File(program, true);
        else {
            let dirs = services.environment.get("PATH").split(util.OS.isWindows ? ";" : ":");
            // Windows tries the CWD first TODO: desirable?
            if (util.OS.isWindows)
                dirs = [io.cwd].concat(dirs);

lookup:
            for (let [, dir] in Iterator(dirs)) {
                file = File.joinPaths(dir, program, io.cwd);
                try {
                    if (file.exists())
                        break;

                    // TODO: couldn't we just palm this off to the start command?
                    // automatically try to add the executable path extensions on windows
                    if (util.OS.isWindows) {
                        let extensions = services.environment.get("PATHEXT").split(";");
                        for (let [, extension] in Iterator(extensions)) {
                            file = File.joinPaths(dir, program + extension, io.cwd);
                            if (file.exists())
                                break lookup;
                        }
                    }
                }
                catch (e) {}
            }
        }

        if (!file || !file.exists()) {
            dactyl.echoerr("Command not found: " + program);
            return -1;
        }

        let process = services.Process();

        process.init(file);
        process.run(false, args.map(String), args.length);
        try {
            if (blocking)
                while (process.isRunning)
                    util.threadYield(false, true);
        }
        catch (e) {
            process.kill();
            throw e;
        }

        return process.exitValue;
    },

    // FIXME: multiple paths?
    /**
     * Sources files found in 'runtimepath'. For each relative path in *paths*
     * each directory in 'runtimepath' is searched and if a matching file is
     * found it is sourced. Only the first file found (per specified path) is
     * sourced unless *all* is specified, then all found files are sourced.
     *
     * @param {string[]} paths An array of relative paths to source.
     * @param {boolean} all Whether all found files should be sourced.
     */
    sourceFromRuntimePath: function (paths, all) {
        let dirs = options["runtimepath"];
        let found = false;

        dactyl.echomsg("Searching for " + paths.join(" ").quote() + " in " + options.get("runtimepath").stringValue, 2);

    outer:
        for (let [, dir] in Iterator(dirs)) {
            for (let [, path] in Iterator(paths)) {
                let file = File.joinPaths(dir, path, this.cwd);

                dactyl.echomsg("Searching for " + file.path.quote(), 3);

                if (file.exists() && file.isFile() && file.isReadable()) {
                    io.source(file.path, false);
                    found = true;

                    if (!all)
                        break outer;
                }
            }
        }

        if (!found)
            dactyl.echomsg("not found in 'runtimepath': " + paths.join(" ").quote(), 1);

        return found;
    },

    /**
     * Reads Ex commands, JavaScript or CSS from *filename*.
     *
     * @param {string} filename The name of the file to source.
     * @param {boolean} silent Whether errors should be reported.
     */
    source: function (filename, silent) {
        defineModule.loadLog.push("sourcing " + filename);
        let time = Date.now();
        this.withSavedValues(["sourcing"], function () {
            this.sourcing = null;
            try {
                var file = io.File(filename);

                if (!file.exists() || !file.isReadable() || file.isDirectory()) {
                    if (!silent)
                        dactyl.echoerr("E484: Can't open file " + filename.quote());
                    return;
                }

                dactyl.echomsg("sourcing " + filename.quote(), 2);

                let uri = services.io.newFileURI(file);

                // handle pure JavaScript files specially
                if (/\.js$/.test(filename)) {
                    try {
                        dactyl.loadScript(uri.spec, Script(file));
                        dactyl.helpInitialized = false;
                    }
                    catch (e) {
                        if (e.fileName)
                            try {
                                e.fileName = e.fileName.replace(/^(chrome|resource):.*? -> /, "");
                                if (e.fileName == uri.spec)
                                    e.fileName = filename;
                                e.echoerr = <>{e.fileName}:{e.lineNumber}: {e}</>;
                            }
                            catch (e) {}
                        throw e;
                    }
                }
                else if (/\.css$/.test(filename))
                    styles.registerSheet(uri.spec, false, true);
                else {
                    commands.execute(file.read(), null, silent || "loud", null,
                        { file: file.path, line: 1 });
                }

                if (this._scriptNames.indexOf(file.path) == -1)
                    this._scriptNames.push(file.path);

                dactyl.echomsg("finished sourcing " + filename.quote(), 2);

                dactyl.log("Sourced: " + filename, 3);
            }
            catch (e) {
                if (!(e instanceof FailedAssertion))
                    dactyl.reportError(e);
                let message = "Sourcing file: " + (e.echoerr || file.path + ": " + e);
                if (!silent)
                    dactyl.echoerr(message);
            }
            finally {
                defineModule.loadLog.push("done sourcing " + filename + ": " + (Date.now() - time) + "ms");
            }
        });
    },

    // TODO: when https://bugzilla.mozilla.org/show_bug.cgi?id=68702 is
    // fixed use that instead of a tmpfile
    /**
     * Runs *command* in a subshell and returns the output in a string. The
     * shell used is that specified by the 'shell' option.
     *
     * @param {string} command The command to run.
     * @param {string} input Any input to be provided to the command on stdin.
     * @returns {string}
     */
    system: function (command, input) {
        dactyl.echomsg("Calling shell to execute: " + command, 4);

        function escape(str) '"' + str.replace(/[\\"$]/g, "\\$&") + '"';

        return this.withTempFiles(function (stdin, stdout, cmd) {
            if (input instanceof File)
                stdin = input;
            else if (input)
                stdin.write(input);

            let shell = File.expandPath(options["shell"]);
            // TODO: implement 'shellredir'
            if (util.OS.isWindows && !/sh/.test(options["shell"])) {
                command = "cd /D " + this.cwd + " && " + command + " > " + stdout.path + " 2>&1" + " < " + stdin.path;
                var res = this.run(shell, options["shellcmdflag"].split(/\s+/).concat(command), true);
            }
            else {
                cmd.write("cd " + escape(this.cwd) + "\n" +
                        ["exec", ">" + escape(stdout.path), "2>&1", "<" + escape(stdin.path),
                         escape(shell), options["shellcmdflag"], escape(command)].join(" "));
                res = this.run("/bin/sh", ["-e", cmd.path], true);
            }

            let output = stdout.read();
            if (res > 0)
                output += "\nshell returned " + res;
            else if (output)
                output = output.replace(/^(.*)\n$/, "$1");
            return output;
        }) || "";
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
    withTempFiles: function (func, self) {
        let args = util.map(util.range(0, func.length), this.createTempFile);
        try {
            if (!args.every(util.identity))
                return false;
            return func.apply(self || this, args);
        }
        finally {
            args.forEach(function (f) f && f.remove(false));
        }
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
            rtp = "~/" + (util.OS.isWindows ? "" : ".") + config.name;
            services.environment.set(rtpvar, rtp);
        }
        return rtp;
    },

    /**
     * @property {string} The current platform's path separator.
     */
    PATH_SEP: File.PATH_SEP
}, {
    commands: function () {
        commands.add(["cd", "chd[ir]"],
            "Change the current directory",
            function (args) {
                let arg = args[0];

                if (!arg)
                    arg = "~";

                arg = File.expandPath(arg);

                // go directly to an absolute path or look for a relative path
                // match in 'cdpath'
                // TODO: handle ../ and ./ paths
                if (File.isAbsolutePath(arg)) {
                    io.cwd = arg;
                    dactyl.echomsg(io.cwd);
                }
                else {
                    let dirs = options["cdpath"];
                    for (let [, dir] in Iterator(dirs)) {
                        dir = File.joinPaths(dir, arg, io.cwd);

                        if (dir.exists() && dir.isDirectory() && dir.isReadable()) {
                            io.cwd = dir.path;
                            dactyl.echomsg(io.cwd);
                            return;
                        }
                    }

                    dactyl.echoerr("E344: Can't find directory " + arg.quote() + " in cdpath");
                    dactyl.echoerr("E472: Command failed");
                }
            }, {
                argCount: "?",
                completer: function (context) completion.directory(context, true),
                literal: 0
            });

        // NOTE: this command is only used in :source
        commands.add(["fini[sh]"],
            "Stop sourcing a script file",
            function () {
                dactyl.assert(io.sourcing, "E168: :finish used outside of a sourced file");
                io.sourcing.finished = true;
            },
            { argCount: "0" });

        commands.add(["pw[d]"],
            "Print the current directory name",
            function () { dactyl.echomsg(io.cwd); },
            { argCount: "0" });

        commands.add([config.name.replace(/(.)(.*)/, "mk$1[$2rc]")],
            "Write current key mappings and changed options to the config file",
            function (args) {
                dactyl.assert(args.length <= 1, "E172: Only one file name allowed");

                let filename = args[0] || io.getRCFile(null, true).path;
                let file = io.File(filename);

                dactyl.assert(!file.exists() || args.bang,
                              "E189: " + filename.quote() + " exists (add ! to override)");

                // TODO: Use a set/specifiable list here:
                let lines = [cmd.serialize().map(commands.commandToString, cmd) for (cmd in commands) if (cmd.serialize)];
                lines = array.flatten(lines);

                lines.unshift('"' + dactyl.version + "\n");
                lines.push("\n\" vim: set ft=" + config.name + ":");

                try {
                    file.write(lines.join("\n"));
                }
                catch (e) {
                    dactyl.echoerr("E190: Cannot open " + filename.quote() + " for writing");
                    dactyl.log("Could not write to " + file.path + ": " + e.message); // XXX
                }
            }, {
                argCount: "*", // FIXME: should be "?" but kludged for proper error message
                bang: true,
                completer: function (context) completion.file(context, true)
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
                commandline.commandOutput(
                    template.tabular(["<SNR>", "Filename"], ["text-align: right; padding-right: 1em;"],
                        ([i + 1, file] for ([i, file] in Iterator(io._scriptNames)))));  // TODO: add colon and remove column titles for pedantic Vim compatibility?
            },
            { argCount: "0" });

        commands.add(["so[urce]"],
            "Read Ex commands from a file",
            function (args) {
                if (args.length > 1)
                    dactyl.echoerr("E172: Only one file name allowed");
                else
                    io.source(args[0], args.bang);
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

                // NOTE: Vim doesn't replace ! preceded by 2 or more backslashes and documents it - desirable?
                // pass through a raw bang when escaped or substitute the last command

                // This is an asinine and irritating feature when we have searchable
                // command-line history. --Kris
                if (options["banghist"]) {
                    // replaceable bang and no previous command?
                    dactyl.assert(!/((^|[^\\])(\\\\)*)!/.test(arg) || io._lastRunCommand,
                        "E34: No previous command");

                    arg = arg.replace(/(\\)*!/g,
                        function (m) /^\\(\\\\)*!$/.test(m) ? m.replace("\\!", "!") : m.replace("!", io._lastRunCommand)
                    );
                }

                io._lastRunCommand = arg;

                let output = io.system(arg);

                commandline.command = "!" + arg;
                commandline.commandOutput(<span highlight="CmdOutput">{output}</span>);

                autocommands.trigger("ShellCmdPost", {});
            }, {
                argCount: "?", // TODO: "1" - probably not worth supporting weird Vim edge cases. The dream is dead. --djk
                bang: true,
                completer: function (context) completion.shellCommand(context),
                literal: 0
            });
    },
    completion: function () {
        completion.charset = function (context) {
            context.anchored = false;
            context.keys = {
                text: util.identity,
                description: services.charset.getCharsetTitle
            };
            context.generate = function () iter(services.charset.getDecoderList());
        };

        completion.directory = function directory(context, full) {
            this.file(context, full);
            context.filters.push(function ({ item }) item.isDirectory());
        };

        completion.environment = function environment(context) {
            let command = util.OS.isWindows ? "set" : "env";
            let lines = io.system(command).split("\n");
            lines.pop();

            context.title = ["Environment Variable", "Value"];
            context.generate = function () lines.map(function (line) (line.match(/([^=]+)=(.+)/) || []).slice(1));
        };

        completion.file = function file(context, full, dir) {
            // dir == "" is expanded inside readDirectory to the current dir
            function getDir(str) str.match(/^(?:.*[\/\\])?/)[0];
            dir = getDir(dir || context.filter);

            let file = util.getFile(dir);
            if (file && file.exists() && !file.isDirectory())
                file = file.parent;

            if (!full)
                context.advance(dir.length);

            context.title = [full ? "Path" : "Filename", "Type"];
            context.keys = {
                text: !full ? "leafName" : function (f) dir + f.leafName,
                description: function (f) f.isDirectory() ? "Directory" : "File",
                isdir: function (f) f.isDirectory(),
                icon: function (f) f.isDirectory() ? "resource://gre/res/html/folder.png"
                                                             : "moz-icon://" + f.leafName
            };
            context.compare = function (a, b)
                        b.isdir - a.isdir || String.localeCompare(a.text, b.text);

            if (options["wildignore"]) {
                let wig = options.get("wildignore");
                context.filters.push(function ({ item }) item.isDirectory() || !wig.getKey(this.name));
            }

            // context.background = true;
            context.key = dir;
            let channel = io.isJarURL(dir);
            if (channel)
                context.generate = function generate_jar() {
                    let uri = channel.URI.QueryInterface(Ci.nsIJARURI);
                    let file = util.getFile(uri.JARFile);
                    if (file) {
                        // let jar = services.zipReader.getZip(file); Crashes.
                        let jar = services.ZipReader(file);
                        try {
                            let path = decodeURI(getDir(uri.JAREntry));
                            return [
                                {
                                      isDirectory: function () s.substr(-1) == "/",
                                      leafName: /([^\/]*)\/?$/.exec(s)[1]
                                }
                                for (s in iter(jar.findEntries("*"))) if (s.indexOf(path) == 0)
                            ]
                        }
                        finally {
                            jar.close();
                        }
                    }
                };
            else
                context.generate = function generate_file() {
                    try {
                        util.dump(String(file), file && file.path);
                        return io.File(file || dir).readDirectory();
                    }
                    catch (e) {
                        util.reportError(e);
                    }
                    return [];
                };
        };

        completion.runtime = function (context) {
            for (let [, dir] in Iterator(options["runtimepath"]))
                context.fork(dir, 0, this, function (context) {
                    dir = dir.replace("/+$", "") + "/";
                    completion.file(context, true, dir + context.filter);
                    context.title[0] = dir;
                    context.keys.text = function (f) f.path.substr(dir.length);
                });
        };

        completion.shellCommand = function shellCommand(context) {
            context.title = ["Shell Command", "Path"];
            context.generate = function () {
                let dirNames = services.environment.get("PATH").split(util.OS.isWindows ? ";" : ":");
                let commands = [];

                for (let [, dirName] in Iterator(dirNames)) {
                    let dir = io.File(dirName);
                    if (dir.exists() && dir.isDirectory()) {
                        commands.push([[file.leafName, dir.path] for (file in dir.iterDirectory())
                                            if (file.isFile() && file.isExecutable())]);
                    }
                }

                return array.flatten(commands);
            };
        };

        completion.addUrlCompleter("f", "Local files", function (context, full) {
            let match = /^(chrome:\/\/[^\/]+\/)([^/]*)$/.exec(context.filter);
            if (match) {
                context.key = match[1];
                context.advance(match[1].length);
                context.generate = function () iter({
                    content: "Chrome content",
                    locale: "Locale-specific content",
                    skin: "Theme-specific content"
                });
            }
            else if (/^(\.{0,2}|~)\/|^file:/.test(context.filter) || util.getFile(context.filter) || io.isJarURL(context.filter))
                completion.file(context, full);
        });
    },
    javascript: function () {
        JavaScript.setCompleter([File, File.expandPath],
            [function (context, obj, args) {
                context.quote[2] = "";
                completion.file(context, true);
            }]);

    },
    options: function () {
        var shell, shellcmdflag;
        if (util.OS.isWindows) {
            shell = "cmd.exe";
            shellcmdflag = "/c";
        }
        else {
            shell = services.environment.get("SHELL") || "sh";
            shellcmdflag = "-c";
        }

        options.add(["banghist", "bh"],
            "Replace occurrences of ! with the previous command when executing external commands",
            "boolean", true);

        options.add(["fileencoding", "fenc"],
            "Sets the character encoding of read and written files",
            "string", "UTF-8", {
                completer: function (context) completion.charset(context),
                getter: function () File.defaultEncoding,
                setter: function (value) (File.defaultEncoding = value)
            });
        options.add(["cdpath", "cd"],
            "List of directories searched when executing :cd",
            "stringlist", ["."].concat(services.environment.get("CDPATH").split(/[:;]/).filter(util.identity)).join(","),
            { setter: function (value) File.expandPathList(value) });

        options.add(["runtimepath", "rtp"],
            "List of directories searched for runtime files",
            "stringlist", IO.runtimePath);

        options.add(["shell", "sh"],
            "Shell to use for executing :! and :run commands",
            "string", shell);

        options.add(["shellcmdflag", "shcf"],
            "Flag passed to shell when executing :! and :run commands",
            "string", shellcmdflag,
            {
                getter: function (value) {
                    if (this.hasChanged || !util.OS.isWindows)
                        return value;
                    return /sh/.test(options["shell"]) ? "-c" : "/c";
                }
            });

        options.add(["wildignore", "wig"],
            "List of file patterns to ignore when completing files",
            "regexplist", "");
    }
});

// vim: set fdm=marker sw=4 ts=4 et:
