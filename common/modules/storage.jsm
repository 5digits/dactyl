// Copyright (c) 2008-2015 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

defineModule("storage", {
    exports: ["AsyncFile", "File", "Storage", "storage"],
    require: ["promises", "services", "util"]
});

lazyRequire("config", ["config"]);
lazyRequire("io", ["IO"]);
lazyRequire("overlay", ["overlay"]);

lazyRequire("resource://gre/modules/osfile.jsm", ["OS"]);

var win32 = /^win(32|nt)$/i.test(services.runtime.OS);
var myObject = JSON.parse("{}").constructor;

var global = Cu.getGlobalForObject(this);

var StoreBase = Class("StoreBase", {
    OPTIONS: ["privateData", "replacer"],

    fireEvent: function (event, arg) { storage.fireEvent(this.name, event, arg); },

    get serial() { return JSON.stringify(this._object, this.replacer); },

    init: function init(name, store, load, options) {
        this._load = load;
        this._options = options;

        this.__defineGetter__("store", () => store);
        this.__defineGetter__("name", () => name);
        for (let [k, v] of iter(options))
            if (this.OPTIONS.indexOf(k) >= 0)
                this[k] = v;
        this.reload();
    },

    clone: function clone(storage) {
        let store = storage.privateMode ? false : this.store;
        let res = this.constructor(this.name, store, this._load, this._options);
        res.storage = storage;
        return res;
    },

    makeOwn: function makeOwn(val) {
        if (typeof val != "object")
            return val;
        if (Cu.getGlobalForObject(val) == global)
            return val;
        return JSON.parse(JSON.stringify(val, this.replacer));
    },

    changed: function () { this.timer && this.timer.tell(); },

    reload: function reload() {
        this._object = this._load() || this._constructor();
        this.fireEvent("change", null);
    },

    delete: function delete_() {
        delete storage.keys[this.name];
        delete storage[this.name];
        return OS.File.remove(
            storage.infoPath.child(this.name).path);
    },

    save: function () { (this.storage || storage)._saveData(this); },

    "@@iterator": function () iter(this._object)
});

var ArrayStore = Class("ArrayStore", StoreBase, {
    _constructor: Array,

    get length() { return this._object.length; },

    set: function set(index, value, quiet) {
        var orig = this._object[index];
        this._object[index] = this.makeOwn(value);
        if (!quiet)
            this.fireEvent("change", index);

        return orig;
    },

    push: function push(value) {
        this._object.push(this.makeOwn(value));
        this.fireEvent("push", this._object.length);
    },

    pop: function pop(value, ord) {
        if (ord == null)
            var res = this._object.pop();
        else
            res = this._object.splice(ord, 1)[0];

        this.fireEvent("pop", this._object.length, ord);
        return res;
    },

    shift: function shift(value) {
        var res = this._object.shift();
        this.fireEvent("shift", this._object.length);
        return res;
    },

    insert: function insert(value, ord) {
        value = this.makeOwn(value);
        if (ord == 0)
            this._object.unshift(value);
        else
            this._object = this._object.slice(0, ord)
                               .concat([value])
                               .concat(this._object.slice(ord));
        this.fireEvent("insert", this._object.length, ord);
    },

    truncate: function truncate(length, fromEnd) {
        var res = this._object.length;
        if (this._object.length > length) {
            if (fromEnd)
                this._object.splice(0, this._object.length - length);
            this._object.length = length;
            this.fireEvent("truncate", length);
        }
        return res;
    },

    // XXX: Awkward.
    mutate: function mutate(funcName) {
        var _funcName = funcName;
        arguments[0] = this._object;
        this._object = apply(Array, _funcName, arguments)
                                       .map(this.makeOwn.bind(this));
        this.fireEvent("change", null);
    },

    get: function get(index) {
        return index >= 0 ? this._object[index] :
                            this._object[this._object.length + index];
    }
});

var ObjectStore = Class("ObjectStore", StoreBase, {
    _constructor: myObject,

    clear: function () {
        this._object = {};
        this.fireEvent("clear");
    },

    get: function get(key, default_) {
        return this.has(key)        ? this._object[key] :
               arguments.length > 1 ? this.set(key, default_) :
                                      undefined;
    },

    has: function has(key) {
        return hasOwnProperty(this._object, key);
    },

    keys: function keys() {
        return Object.keys(this._object);
    },

    remove: function remove(key) {
        var res = this._object[key];
        delete this._object[key];
        this.fireEvent("remove", key);
        return res;
    },

    set: function set(key, val) {
        var defined = key in this._object;
        var orig = this._object[key];
        this._object[key] = this.makeOwn(val);
        if (!defined)
            this.fireEvent("add", key);
        else if (orig != val)
            this.fireEvent("change", key);
        return val;
    }
});

var sessionGlobal = Cu.import("resource://gre/modules/Services.jsm", {});

var Storage = Module("Storage", {
    Local: function Local(dactyl, modules, window) {
        return {
            init: function init() {
                this.privateMode = PrivateBrowsingUtils.isWindowPrivate(window);
            }
        };
    },

    alwaysReload: {},

    init: function init() {
        this.cleanup();

        let { Services } = Cu.import("resource://gre/modules/Services.jsm", {});
        if (!Services.dactylSession)
            Services.dactylSession = Cu.createObjectIn(sessionGlobal);
        this.session = Services.dactylSession;
    },

    cleanup: function () {
        if (this.keys) {
            this.saveAll();

            for (let key of keys(this.keys)) {
                if (this[key].timer)
                    this[key].timer.flush();
                delete this[key];
            }
        }

        this.keys = {};
        this.observers = {};
    },

    _loadData: function loadData(name, store, type) {
        try {
            let file = storage.infoPath.child(name);
            if (file.exists()) {
                let data = file.read();
                let result = JSON.parse(data);
                if (result instanceof type)
                    return result;
            }
        }
        catch (e) {
            util.reportError(e);
        }
    },

    _saveData: promises.task(function* saveData(obj) {
        if (obj.privateData && this.privateMode)
            return;

        if (obj.store && storage.infoPath) {
            var { path } = storage.infoPath.child(obj.name);
            yield AsyncFile(storage.infoPath.path).mkdir();
            yield AsyncFile(path).write(obj.serial,
                { tmpPath: path + ".part" });
        }
    }),

    storeForSession: function storeForSession(key, val) {
        if (val)
            this.session[key] = sessionGlobal.JSON.parse(JSON.stringify(val));
        else
            delete this.dactylSession[key];
    },

    infoPath: Class.Memoize(() =>
        File(IO.runtimePath.split(",")[0])
            .child("info").child(config.profileName)),

    exists: function exists(key) this.infoPath.child(key).exists(),

    remove: function remove(key) {
        if (this.exists(key)) {
            if (this[key] && this[key].timer)
                this[key].timer.flush();
            delete this[key];
            delete this.keys[key];
            return OS.File.remove(
                this.infoPath.child(key).path);
        }
    },

    newObject: function newObject(key, constructor, params={}) {
        if (params == null || !isObject(params))
            throw Error("Invalid argument type");

        if (this.isLocalModule) {
            apply(this.globalInstance, "newObject", arguments);

            if (!(key in this.keys) && this.privateMode && key in this.globalInstance.keys) {
                let obj = this.globalInstance.keys[key];
                this.keys[key] = this._privatize(obj);
            }

            return this.keys[key];
        }

        let reload = params.reload || this.alwaysReload[key];
        if (!(key in this.keys) || reload) {
            if (key in this && !reload)
                throw Error("Cannot add storage key with that name.");

            let load = () => this._loadData(key, params.store, params.type || myObject);

            this.keys[key] = new constructor(key, params.store, load, params);
            this.keys[key].timer = new Timer(1000, 10000, () => this.save(key));
            this.__defineGetter__(key, function () {
                return this.keys[key];
            });
        }
        return this.keys[key];
    },

    newMap: function newMap(key, options={}) {
        return this.newObject(key, ObjectStore, options);
    },

    newArray: function newArray(key, options={}) {
        return this.newObject(key, ArrayStore, update({ type: Array }, options));
    },

    get observerMaps() {
        return function *() {
            /* FIXME: Symbols */
            yield this.observers;
            for (let window of overlay.windows)
                yield overlay.getData(window, "storage-observers", Object);
        }.call(this);
    },

    addObserver: function addObserver(key, callback, window) {
        var { observers } = this;
        if (window instanceof Ci.nsIDOMWindow)
            observers = overlay.getData(window, "storage-observers", Object);

        if (!hasOwnProperty(observers, key))
            observers[key] = new RealSet;

        observers[key].add(callback);
    },

    removeObserver: function (key, callback) {
        for (let observers of this.observerMaps)
            if (key in observers)
                observers[key].remove(callback);
    },

    fireEvent: function fireEvent(key, event, arg) {
        for (let observers of this.observerMaps)
            for (let observer of observers[key] || [])
                observer(key, event, arg);

        if (key in this.keys && this.keys[key].timer)
            this[key].timer.tell();
    },

    load: function load(key) {
        if (this[key].store && this[key].reload)
            this[key].reload();
    },

    save: function save(key) {
        if (this[key])
            this._saveData(this.keys[key]);
    },

    saveAll: function saveAll() {
        for (let obj of values(this.keys))
            this._saveData(obj);
    },

    _privateMode: false,
    get privateMode() { return this._privateMode; },
    set privateMode(enabled) {
        this._privateMode = Boolean(enabled);

        if (this.isLocalModule) {
            this.saveAll();

            if (!enabled)
                delete this.keys;
            else {
                let { keys } = this;
                this.keys = {};
                for (let [k, v] of iter(keys))
                    this.keys[k] = this._privatize(v);
            }
        }
        return this._privateMode;
    },

    _privatize: function privatize(obj) {
        if (obj.privateData && obj.clone)
            return obj.clone(this);
        return obj;
    }
}, {
    Replacer: {
        skipXpcom: function skipXpcom(key, val) {
            return val instanceof Ci.nsISupports ? null : val;
        }
    }
}, {
    cleanup: function (dactyl, modules, window) {
        overlay.setData(window, "storage-callbacks", undefined);
    }
});

/**
 * @class File A class to wrap nsIFile objects and simplify operations
 * thereon.
 *
 * @param {nsIFile|string} path Expanded according to {@link IO#expandPath}
 * @param {boolean} checkPWD Whether to allow expansion relative to the
 *          current directory. @default true
 * @param {string} charset The charset of the file. @default File.defaultEncoding
 */
var File = Class("File", {
    init: function init(path, checkPWD, charset) {
        if (charset)
            this.charset = charset;

        if (isString(path))
            path = File.expandPath(path);

        this._path = path;
        this._checkPWD = checkPWD;
        return this;
    },

    get path() {
        if (!this.fileified && isString(this._path) && File.isAbsolutePath(this._path))
            return this._path;

        return this.file.path;
    },

    set path(path) {
        return this.file.path = path;
    },

    file: Class.Memoize(function () {
        let path = this._path;
        let file = services.File();

        if (path instanceof Ci.nsIFileURL)
            path = path.file;

        if (path instanceof Ci.nsIFile || path instanceof File)
            file = path.clone();
        else if (path.startsWith("file://"))
            file = services["file:"].getFileFromURLSpec(path);
        else {
            try {
                let checkPWD = this._checkPWD;
                if (!File.isAbsolutePath(path) && !(checkPWD instanceof Ci.nsIFile))
                    checkPWD = File(services.directory.get("CurWorkD", Ci.nsIFile));

                if (!File.isAbsolutePath(path))
                    file = checkPWD.child(path);
                else
                    file.initWithPath(path);
            }
            catch (e) {
                util.reportError(e);
                return File.DoesNotExist(path, e);
            }
        }

        this.fileified = true;
        return file.QueryInterface(Ci.nsILocalFile);
    }),

    get async() { return AsyncFile(this); },

    charset: Class.Memoize(() => File.defaultEncoding),

    /**
     * @property {nsIFileURL} Returns the nsIFileURL object for this file.
     */
    URI: Class.Memoize(function () {
        let uri = services.io.newFileURI(this.file)
                          .QueryInterface(Ci.nsIFileURL);
        uri.QueryInterface(Ci.nsIMutable).mutable = false;
        return uri;
    }),

    /**
     * Iterates over the objects in this directory.
     */
    iterDirectory: function* iterDirectory() {
        if (!this.exists())
            throw Error(_("io.noSuchFile"));
        if (!this.isDirectory())
            throw Error(_("io.eNotDir"));
        for (let file of iter(this.directoryEntries))
            yield this.constructor(file);
    },

    /**
     * Returns a new file for the given child of this directory entry.
     */
    child: function child(...args) {
        let path = this.path;

        args = args.map(p => p.replace(File.pathSplit, File.PATH_SEP));
        util.assert(!args.some(File.isAbsolutePath),
                    "Absolute paths not allowed", false);

        let newPath = OS.Path.join.apply(OS.Path, [this.path].concat(args));

        return this.constructor(newPath, null, this.charset);
    },

    get fileName() { return OS.Path.basename(this.path); },

    get parent() {
        return this.constructor(OS.Path.dirname(this.path),
                                null,
                                this.charset);
    },

    /**
     * Returns an iterator for all lines in a file.
     */
    get lines() {
        return File.readLines(services.FileInStream(this.file, -1, 0, 0),
                              this.charset);
    },

    /**
     * Reads this file's entire contents in "text" mode and returns the
     * content as a string.
     *
     * @param {string} encoding The encoding from which to decode the file.
     *          @default #charset
     * @returns {string}
     */
    read: function read(encoding) {
        let ifstream = services.FileInStream(this.file, -1, 0, 0);

        return File.readStream(ifstream, encoding || this.charset);
    },

    /**
     * Returns the list of files in this directory.
     *
     * @param {boolean} sort Whether to sort the returned directory
     *     entries.
     * @returns {[nsIFile]}
     */
    readDirectory: function readDirectory(sort) {
        if (!this.isDirectory())
            throw Error(_("io.eNotDir"));

        let array = [e for (e of this.iterDirectory())];
        if (sort)
            array.sort((a, b) => (b.isDirectory() - a.isDirectory() ||
                                  String.localeCompare(a.path, b.path)));
        return array;
    },

    /**
     * Returns a new nsIFileURL object for this file.
     *
     * @returns {nsIFileURL}
     */
    toURI: deprecated("#URI", function toURI() services.io.newFileURI(this.file)),

    /**
     * Writes the string *buf* to this file.
     *
     * @param {string} buf The file content.
     * @param {string|number} mode The file access mode, a bitwise OR of
     *     the following flags:
     *       {@link #MODE_RDONLY}:   0x01
     *       {@link #MODE_WRONLY}:   0x02
     *       {@link #MODE_RDWR}:     0x04
     *       {@link #MODE_CREATE}:   0x08
     *       {@link #MODE_APPEND}:   0x10
     *       {@link #MODE_TRUNCATE}: 0x20
     *       {@link #MODE_SYNC}:     0x40
     *     Alternatively, the following abbreviations may be used:
     *       ">"  is equivalent to {@link #MODE_WRONLY} | {@link #MODE_CREATE} | {@link #MODE_TRUNCATE}
     *       ">>" is equivalent to {@link #MODE_WRONLY} | {@link #MODE_CREATE} | {@link #MODE_APPEND}
     * @default ">"
     * @param {number} perms The file mode bits of the created file. This
     *     is only used when creating a new file and does not change
     *     permissions if the file exists.
     * @default 0644
     * @param {string} encoding The encoding to used to write the file.
     * @default #charset
     */
    write: function write(buf, mode, perms, encoding) {
        function getStream(defaultChar) {
            return services.ConvOutStream(ofstream, encoding, 0, defaultChar);
        }
        if (buf instanceof File)
            buf = buf.read();

        if (!encoding)
            encoding = this.charset;

        if (mode == ">>")
            mode = File.MODE_WRONLY | File.MODE_CREATE | File.MODE_APPEND;
        else if (!mode || mode == ">")
            mode = File.MODE_WRONLY | File.MODE_CREATE | File.MODE_TRUNCATE;

        if (!perms)
            perms = 0o644;
        if (!this.exists()) // OCREAT won't create the directory
            this.create(this.NORMAL_FILE_TYPE, perms);

        let ofstream = services.FileOutStream(this.file, mode, perms, 0);
        try {
            var ocstream = getStream(0);
            ocstream.writeString(buf);
        }
        catch (e if e.result == Cr.NS_ERROR_LOSS_OF_SIGNIFICANT_DATA) {
            ocstream.close();
            ocstream = getStream("?".charCodeAt(0));
            ocstream.writeString(buf);
            return false;
        }
        finally {
            try {
                ocstream.close();
            }
            catch (e) {}
            ofstream.close();
        }
        return true;
    },

    // Wrapped native methods:
    copyTo: function copyTo(dir, name) {
        return this.file.copyTo(this.constructor(dir).file,
                                name);
    },

    copyToFollowingLinks: function copyToFollowingLinks(dir, name) {
        return this.file.copyToFollowingLinks(this.constructor(dir).file,
                                              name);
    },

    moveTo: function moveTo(dir, name) {
        return this.file.moveTo(this.constructor(dir).file,
                                name);
    },

    equals: function equals(file) {
        return this.file.equals(this.constructor(file).file);
    },

    contains: function contains(dir, recur) {
        return this.file.contains(this.constructor(dir).file,
                                  recur);
    },

    getRelativeDescriptor: function getRelativeDescriptor(file) {
        return this.file.getRelativeDescriptor(this.constructor(file).file);
    },

    setRelativeDescriptor: function setRelativeDescriptor(file, path) {
        this.file.setRelativeDescriptor(this.constructor(file).file,
                                        path);
    }
}, {
    /**
     * @property {number} Open for reading only.
     * @final
     */
    MODE_RDONLY: 0x01,

    /**
     * @property {number} Open for writing only.
     * @final
     */
    MODE_WRONLY: 0x02,

    /**
     * @property {number} Open for reading and writing.
     * @final
     */
    MODE_RDWR: 0x04,

    /**
     * @property {number} If the file does not exist, the file is created.
     *     If the file exists, this flag has no effect.
     * @final
     */
    MODE_CREATE: 0x08,

    /**
     * @property {number} The file pointer is set to the end of the file
     *     prior to each write.
     * @final
     */
    MODE_APPEND: 0x10,

    /**
     * @property {number} If the file exists, its length is truncated to 0.
     * @final
     */
    MODE_TRUNCATE: 0x20,

    /**
     * @property {number} If set, each write will wait for both the file
     *     data and file status to be physically updated.
     * @final
     */
    MODE_SYNC: 0x40,

    /**
     * @property {number} With MODE_CREATE, if the file does not exist, the
     *     file is created. If the file already exists, no action and NULL
     *     is returned.
     * @final
     */
    MODE_EXCL: 0x80,

    /**
     * @property {string} The current platform's path separator.
     */
    PATH_SEP: Class.Memoize(() => /foo(.)bar/.exec(OS.Path.join("foo", "bar"))[1]),

    pathSplit: Class.Memoize(function () {
        return util.regexp("[/" + util.regexp.escape(this.PATH_SEP) + "]",
                           "g");
    }),

    DoesNotExist: function DoesNotExist(path, error) {
        return {
            __proto__: DoesNotExist.prototype,
            path: path,
            exists: function () { return false; },
            __noSuchMethod__: function () {
                throw error || Error("Does not exist");
            }
        };
    },

    defaultEncoding: "UTF-8",

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
    expandPath: function expandPath(path, relative) {
        function getenv(name) {
            return services.environment.get(name);
        }

        // expand any $ENV vars - this is naive but so is Vim and we like to be compatible
        // TODO: Vim does not expand variables set to an empty string (and documents it).
        // Kris reckons we shouldn't replicate this 'bug'. --djk
        // TODO: should we be doing this for all paths?
        // No.
        function expand(path) {
            return path.replace(
                win32 ? /\$(\w+)\b|\${(\w+)}|%(\w+)%/g
                    : /\$(\w+)\b|\${(\w+)}/g,
                (m, n1, n2, n3) => (getenv(n1 || n2 || n3) || m));
        }
        path = expand(path);

        // expand ~
        if (!relative && RegExp("~(?:$|[/" + util.regexp.escape(File.PATH_SEP) + "])").test(path))
            path = OS.Path.join(OS.Constants.Path.homeDir,
                                path.substr(2));

        return OS.Path.normalize(path.replace(/\//g, File.PATH_SEP));
    },

    expandPathList: function (list) {
        return list.map(this.expandPath);
    },

    readURL: function readURL(url, encoding) {
        let channel = services.io.newChannel(url, null, null);
        channel.contentType = "text/plain";
        return this.readStream(channel.open(), encoding);
    },

    readStream: function readStream(ifstream, encoding) {
        try {
            var icstream = services.CharsetStream(
                    ifstream, encoding || File.defaultEncoding, 4096, // buffer size
                    services.CharsetStream.DEFAULT_REPLACEMENT_CHARACTER);

            let buffer = [];
            let str = {};
            while (icstream.readString(4096, str) != 0)
                buffer.push(str.value);
            return buffer.join("");
        }
        finally {
            icstream.close();
            ifstream.close();
        }
    },

    readLines: function* readLines(ifstream, encoding) {
        try {
            var icstream = services.CharsetStream(
                    ifstream, encoding || File.defaultEncoding, 4096, // buffer size
                    services.CharsetStream.DEFAULT_REPLACEMENT_CHARACTER);

            var value = {};
            while (icstream.readLine(value))
                yield value.value;
        }
        finally {
            icstream.close();
            ifstream.close();
        }
    },

    isAbsolutePath: function isAbsolutePath(path) {
        try {
            return OS.Path.split(path).absolute;
        }
        catch (e) {
            return false;
        }
    },

    replacePathSep: function replacePathSep(path) {
        return path.split("/").join(File.PATH_SEP);
    },

    joinPaths: function joinPaths(head, tail, cwd) {
        let path = this(head, cwd);
        try {
            // FIXME: should only expand environment vars and normalize path separators
            path.appendRelativePath(this.expandPath(tail, true));
        }
        catch (e) {
            return File.DoesNotExist(e);
        }
        return path;
    }
});

{
    let file = services.File();
    Object.keys(file).forEach(function (prop) {
        if (!(prop in File.prototype)) {
            let isFunction;
            try {
                isFunction = callable(file[prop]);
            }
            catch (e) {}

            if (isFunction)
                File.prototype[prop] = util.wrapCallback(function wrapper() {
                    return apply(this.file, prop, arguments);
                });
            else
                Object.defineProperty(File.prototype, prop, {
                    configurable: true,
                    get: function wrap_get() { return this.file[prop]; },
                    set: function wrap_set(val) { this.file[prop] = val; }
                });
        }
    });
    file = null;
}

var AsyncFile = Class("AsyncFile", File, {
    get async() { return this; },

    /*
     * Creates a new directory, along with any parent directories which
     * do not currently exist.
     *
     * @param {object} options Options for directory creation. As in
     *      `OS.File.makeDir`
     * @returns {Promise}
     */
    // TODO: Is there a reason not to merge this with makeDir?
    mkdir: promises.task(function* mkdir(options) {
        let split = OS.Path.split(this.path);
        util.assert(split.absolute);

        let file = File(split.winDrive ? split.winDrive + File.PATH_SEP
                                       : File.PATH_SEP);

        for (let component of split.components) {
            let f = file.child(component);
            try {
                var stat = yield OS.File.stat(f.path);
            }
            catch (e) {
                // Does not exist, or other error.
                break;
            }
            if (!stat.isDir)
                throw new Error("Component in path is not a directory");
            file = f;
        }

        options = update({},
                         options || {},
                         { ignoreExisting: true,
                           from: file.path });

        yield OS.File.makeDir(this.path, options);
    }),

    _setEncoding: function _setEncoding(options) {
        if (this.encoding != null && !("encoding" in options))
            options = update({}, options,
                             { encoding: this.encoding });

        return options;
    },

    /**
     * Reads this file's entire contents in "text" mode and returns the
     * content as a string.
     */
    read: function read(options={}) {
        return OS.File.read(this.path, this._setEncoding(options));
    },

    /**
     * Returns the list of files in this directory.
     */
    readDirectory: function readDirectory(callback) {
        let iter = new OS.File.DirectoryIterator(dir);
        let close = () => { iter.close(); };

        return iter.forEach(callback)
                   .then(close, close);
    },

    /**
     * Writes the string *buf* to this file.
     */
    write: function write(buf, options={}) {
        return OS.File.writeAtomic(this.path, buf,
                                   this._setEncoding(options));
    },

    copyTo: function copyTo(path, options) {
        return OS.File.copy(this.path, path, options);
    },

    moveTo: function moveTo(path, options) {
        return OS.File.move(this.path, path, options);
    }
});

for (let m of ["makeDir",
               "stat",
               "remove",
               "removeDir",
               "removeEmptyDir"]) {
    let method = m;
    AsyncFile.prototype[method] = function (options) {
        return OS.File[method](this.path, options);
    };
}

endModule();

// catch(e){ dump(e + "\n" + (e.stack || Error().stack)); Components.utils.reportError(e) }

// vim: set fdm=marker sw=4 sts=4 ts=8 et ft=javascript:
