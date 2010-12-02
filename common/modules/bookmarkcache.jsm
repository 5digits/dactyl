// Copyright ©2008-2010 Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

Components.utils.import("resource://dactyl/base.jsm");
defineModule("bookmarkcache", {
    exports: ["Bookmark", "BookmarkCache", "Keyword", "bookmarkcache"],
    require: ["services", "storage", "util"]
});

const Bookmark = Struct("url", "title", "icon", "post", "keyword", "tags", "id");
const Keyword = Struct("keyword", "title", "icon", "url");
Bookmark.defaultValue("icon", function () BookmarkCache.getFavicon(this.url));
Bookmark.prototype.__defineGetter__("extra", function () [
                        ["keyword", this.keyword,         "Keyword"],
                        ["tags",    this.tags.join(", "), "Tag"]
                    ].filter(function (item) item[1]));

const name = "bookmark-cache";

const BookmarkCache = Module("BookmarkCache", XPCOM(Ci.nsINavBookmarkObserver), {
    POST: "bookmarkProperties/POSTData",

    init: function init() {
        services.bookmarks.addObserver(this, false);
    },

    __iterator__: function () (val for ([, val] in Iterator(bookmarkcache.bookmarks))),

    get bookmarks() Class.replaceProperty(this, "bookmarks", this.load()),

    get keywords() array.toObject([[b.keyword, b] for (b in this) if (b.keyword)]),

    rootFolders: ["toolbarFolder", "bookmarksMenuFolder", "unfiledBookmarksFolder"]
        .map(function (s) services.bookmarks[s]),

    _deleteBookmark: function deleteBookmark(id) {
        let result = this.bookmarks[id] || null;
        delete this.bookmarks[id];
        return result;
    },

    _loadBookmark: function loadBookmark(node) {
        if (node.uri == null) // How does this happen?
            return false;
        let uri = util.newURI(node.uri);
        let keyword = services.bookmarks.getKeywordForBookmark(node.itemId);
        let tags = services.tagging.getTagsForURI(uri, {}) || [];
        let post = BookmarkCache.getAnnotation(node.itemId, this.POST);
        return Bookmark(node.uri, node.title, node.icon && node.icon.spec, post, keyword, tags, node.itemId);
    },

    get: function (url) {
        let ids = services.bookmarks.getBookmarkIdsForURI(util.newURI(url), {});
        for (let id in values(ids))
            if (id in this.bookmarks)
                return this.bookmarks[id];
        return null;
    },

    readBookmark: function readBookmark(id) ({
        itemId: id,
        uri:    services.bookmarks.getBookmarkURI(id).spec,
        title:  services.bookmarks.getItemTitle(id)
    }),

    findRoot: function findRoot(id) {
        do {
            var root = id;
            id = services.bookmarks.getFolderIdForItem(id);
        } while (id != services.bookmarks.placesRoot && id != root);
        return root;
    },

    isBookmark: function (id) this.rootFolders.indexOf(this.findRoot(id)) >= 0,

    isRegularBookmark: function isRegularBookmark(id) {
        do {
            var root = id;
            if (services.livemark && services.livemark.isLivemark(id))
                return false;
            id = services.bookmarks.getFolderIdForItem(id);
        } while (id != services.bookmarks.placesRoot && id != root);
        return this.rootFolders.indexOf(root) >= 0;
    },

    // Should be made thread safe.
    load: function load() {
        let bookmarks = {};

        let folders = this.rootFolders.slice();
        let query = services.history.getNewQuery();
        let options = services.history.getNewQueryOptions();
        while (folders.length > 0) {
            query.setFolders(folders, 1);
            folders.shift();
            let result = services.history.executeQuery(query, options);
            let folder = result.root;
            folder.containerOpen = true;

            // iterate over the immediate children of this folder
            for (let i = 0; i < folder.childCount; i++) {
                let node = folder.getChild(i);
                if (node.type == node.RESULT_TYPE_FOLDER)   // folder
                    folders.push(node.itemId);
                else if (node.type == node.RESULT_TYPE_URI) // bookmark
                    bookmarks[node.itemId] = this._loadBookmark(node);
            }

            // close a container after using it!
            folder.containerOpen = false;
        }

        return bookmarks;
    },

    onItemAdded: function onItemAdded(itemId, folder, index) {
        if (services.bookmarks.getItemType(itemId) == services.bookmarks.TYPE_BOOKMARK) {
            if (this.isBookmark(itemId)) {
                let bmark = this._loadBookmark(this.readBookmark(itemId));
                this.bookmarks[bmark.id] = bmark;
                storage.fireEvent(name, "add", bmark);
            }
        }
    },
    onItemRemoved: function onItemRemoved(itemId, folder, index) {
        let result = this._deleteBookmark(itemId);
        if (result)
            storage.fireEvent(name, "remove", result);
    },
    onItemChanged: function onItemChanged(itemId, property, isAnnotation, value) {
        if (isAnnotation)
            if (property === this.POST)
                [property, value] = ["post", BookmarkCache.getAnnotation(itemId, this.POST)];
            else
                return;

        let bookmark = this.bookmarks[itemId];
        if (bookmark) {
            if (property == "tags")
                value = services.tagging.getTagsForURI(util.newURI(bookmark.url), {});
            if (property in bookmark) {
                bookmark[property] = value;
                storage.fireEvent(name, "change", { __proto__: bookmark, changed: property });
            }
        }
    }
}, {
    getAnnotation: function getAnnotation(item, anno)
        services.annotation.itemHasAnnotation(item, anno) ?
        services.annotation.getItemAnnotation(item, anno) : null,
    getFavicon: function getFavicon(uri) {
        try {
            return services.favicon.getFaviconImageForPage(util.newURI(uri)).spec;
        }
        catch (e) {
            return "";
        }
    }
});

endModule();

// vim: set fdm=marker sw=4 sts=4 et ft=javascript:
