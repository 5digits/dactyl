/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * vim: set ts=4 sw=4 et tw=80:
 *
 * ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Mozilla Communicator client code, released
 * March 31, 1998.
 *
 * The Initial Developer of the Original Code is
 * Netscape Communications Corporation.
 * Portions created by the Initial Developer are Copyright (C) 1998
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Robert Ginda <rginda@netscape.com>
 *   Kris Maglione <maglione.k@gmail.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either of the GNU General Public License Version 2 or later (the "GPL"),
 * or the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * What follows is the ordinary mozIJSSubScriptLoader modified only to strip the
 * useless, irritating, and troublesome "foo -> " prefixes from filenames.
 */

#include "dactylUtils.h"
#include "mozJSLoaderUtils.h"

#include "nsIServiceManager.h"
#include "nsIXPConnect.h"

#include "nsIURI.h"
#include "nsIIOService.h"
#include "nsIChannel.h"
#include "nsIConsoleService.h"
#include "nsIScriptError.h"
#include "nsIInputStream.h"
#include "nsNetCID.h"
#include "nsAutoPtr.h"
#include "nsNetUtil.h"
#include "nsIProtocolHandler.h"
#include "nsIScriptSecurityManager.h"
#include "nsIFileURL.h"

// ConvertToUTF16
#include "nsICharsetConverterManager.h"
#include "nsIUnicodeDecoder.h"
template<class T>
inline PRBool EnsureStringLength(T& aStr, PRUint32 aLen)
{
    aStr.SetLength(aLen);
    return (aStr.Length() == aLen);
}

#include "jsapi.h"
#include "jscntxt.h"
#include "jsdbgapi.h"
#include "jsfriendapi.h"

#if GECKO_MAJOR < 10
    static inline JSVersion
    JS_GetVersion(JSContext *cx) {
        return cx->findVersion();
    }
#endif

#include "mozilla/FunctionTimer.h"
#include "mozilla/scache/StartupCache.h"
#include "mozilla/scache/StartupCacheUtils.h"

using namespace mozilla::scache;
class nsACString_internal : nsACString {};

namespace mozilla {
    namespace scache {
        nsresult PathifyURI(nsIURI *in, nsACString_internal &out);
    }
}

/* load() error msgs, XXX localize? */
#define LOAD_ERROR_NOSERVICE "Error creating IO Service."
#define LOAD_ERROR_NOURI "Error creating URI (invalid URL scheme?)"
#define LOAD_ERROR_NOSCHEME "Failed to get URI scheme.  This is bad."
#define LOAD_ERROR_URI_NOT_LOCAL "Trying to load a non-local URI."
#define LOAD_ERROR_NOSTREAM  "Error opening input stream (invalid filename?)"
#define LOAD_ERROR_NOCONTENT "ContentLength not available (not a local URL?)"
#define LOAD_ERROR_BADCHARSET "Error converting to specified charset"
#define LOAD_ERROR_BADREAD   "File Read Error."
#define LOAD_ERROR_READUNDERFLOW "File Read Error (underflow.)"
#define LOAD_ERROR_NOPRINCIPALS "Failed to get principals."
#define LOAD_ERROR_NOSPEC "Failed to get URI spec.  This is bad."

/* Internal linkage, bloody hell... */
static nsresult
ConvertToUTF16(nsIChannel* aChannel, const PRUint8* aData,
               PRUint32 aLength, const nsString& aHintCharset,
               nsString& aString)
{
  if (!aLength) {
    aString.Truncate();
    return NS_OK;
  }

  nsCAutoString characterSet;

  nsresult rv = NS_OK;
  if (aChannel) {
    rv = aChannel->GetContentCharset(characterSet);
  }

  if (!aHintCharset.IsEmpty() && (NS_FAILED(rv) || characterSet.IsEmpty())) {
    // charset name is always ASCII.
    LossyCopyUTF16toASCII(aHintCharset, characterSet);
  }

  if (characterSet.IsEmpty()) {
    // fall back to ISO-8859-1, see bug 118404
    characterSet.AssignLiteral("ISO-8859-1");
  }

  nsCOMPtr<nsICharsetConverterManager> charsetConv =
    do_GetService(NS_CHARSETCONVERTERMANAGER_CONTRACTID, &rv);

  nsCOMPtr<nsIUnicodeDecoder> unicodeDecoder;

  if (NS_SUCCEEDED(rv) && charsetConv) {
    rv = charsetConv->GetUnicodeDecoder(characterSet.get(),
                                        getter_AddRefs(unicodeDecoder));
    if (NS_FAILED(rv)) {
      // fall back to ISO-8859-1 if charset is not supported. (bug 230104)
      rv = charsetConv->GetUnicodeDecoderRaw("ISO-8859-1",
                                             getter_AddRefs(unicodeDecoder));
    }
  }

  // converts from the charset to unicode
  if (NS_SUCCEEDED(rv)) {
    PRInt32 unicodeLength = 0;

    rv = unicodeDecoder->GetMaxLength(reinterpret_cast<const char*>(aData),
                                      aLength, &unicodeLength);
    if (NS_SUCCEEDED(rv)) {
      if (!EnsureStringLength(aString, unicodeLength))
        return NS_ERROR_OUT_OF_MEMORY;

      PRUnichar *ustr = aString.BeginWriting();

      PRInt32 consumedLength = 0;
      PRInt32 originalLength = aLength;
      PRInt32 convertedLength = 0;
      PRInt32 bufferLength = unicodeLength;
      do {
        rv = unicodeDecoder->Convert(reinterpret_cast<const char*>(aData),
                                     (PRInt32 *) &aLength, ustr,
                                     &unicodeLength);
        if (NS_FAILED(rv)) {
          // if we failed, we consume one byte, replace it with U+FFFD
          // and try the conversion again.
          ustr[unicodeLength++] = (PRUnichar)0xFFFD;
          ustr += unicodeLength;

          unicodeDecoder->Reset();
        }
        aData += ++aLength;
        consumedLength += aLength;
        aLength = originalLength - consumedLength;
        convertedLength += unicodeLength;
        unicodeLength = bufferLength - convertedLength;
      } while (NS_FAILED(rv) && (originalLength > consumedLength) && (bufferLength > convertedLength));
      aString.SetLength(convertedLength);
    }
  }
  return rv;
}

// We just use the same reporter as the component loader
static void
mozJSLoaderErrorReporter(JSContext *cx, const char *message, JSErrorReport *rep)
{
    nsresult rv;

    /* Use the console service to register the error. */
    nsCOMPtr<nsIConsoleService> consoleService =
        do_GetService(NS_CONSOLESERVICE_CONTRACTID);

    /*
     * Make an nsIScriptError, populate it with information from this
     * error, then log it with the console service.  The UI can then
     * poll the service to update the Error console.
     */
    nsCOMPtr<nsIScriptError> errorObject =
        do_CreateInstance(NS_SCRIPTERROR_CONTRACTID);

    if (consoleService && errorObject) {
        /*
         * Got an error object; prepare appropriate-width versions of
         * various arguments to it.
         */
        nsAutoString fileUni;
        fileUni.Assign(NS_ConvertUTF8toUTF16(rep->filename));

        PRUint32 column = rep->uctokenptr - rep->uclinebuf;

        rv = errorObject->Init(reinterpret_cast<const PRUnichar*>
                                               (rep->ucmessage),
                               fileUni.get(),
                               reinterpret_cast<const PRUnichar*>
                                               (rep->uclinebuf),
                               rep->lineno, column, rep->flags,
                               "component javascript");
        if (NS_SUCCEEDED(rv)) {
            rv = consoleService->LogMessage(errorObject);
            if (NS_SUCCEEDED(rv)) {
                // We're done!  Skip return to fall thru to stderr
                // printout, for the benefit of those invoking the
                // browser with -console
                // return;
            }
        }
    }

    /*
     * If any of the above fails for some reason, fall back to
     * printing to stderr.
     */
}

static JSBool
Dump(JSContext *cx, uintN argc, jsval *vp)
{
    JSString *str;
    if (!argc)
        return JS_TRUE;

    str = JS_ValueToString(cx, JS_ARGV(cx, vp)[0]);
    if (!str)
        return JS_FALSE;

    size_t length;
    const jschar *chars = JS_GetStringCharsAndLength(cx, str, &length);
    if (!chars)
        return JS_FALSE;

    fputs(NS_ConvertUTF16toUTF8(reinterpret_cast<const PRUnichar*>(chars)).get(), stderr);
    return JS_TRUE;
}

static nsresult
ReportError(JSContext *cx, const char *msg)
{
    JS_SetPendingException(cx, STRING_TO_JSVAL(JS_NewStringCopyZ(cx, msg)));
    return NS_OK;
}

static nsresult
ReadScript(nsIURI *uri, JSContext *cx, JSObject *target_obj,
           jschar *charset, const char *uriStr,
           nsIIOService *serv, nsIPrincipal *principal,
           JSScriptType **scriptObjp)
{
    nsCOMPtr<nsIChannel>     chan;
    nsCOMPtr<nsIInputStream> instream;
    JSPrincipals    *jsPrincipals;
    JSErrorReporter  er;

    nsresult rv;
    // Instead of calling NS_OpenURI, we create the channel ourselves and call
    // SetContentType, to avoid expensive MIME type lookups (bug 632490).
    rv = NS_NewChannel(getter_AddRefs(chan), uri, serv,
                       nsnull, nsnull, nsIRequest::LOAD_NORMAL);
    if (NS_SUCCEEDED(rv)) {
        chan->SetContentType(NS_LITERAL_CSTRING("application/javascript"));
        rv = chan->Open(getter_AddRefs(instream));
    }

    if (NS_FAILED(rv)) {
        return ReportError(cx, LOAD_ERROR_NOSTREAM);
    }

    PRInt32 len = -1;

    rv = chan->GetContentLength(&len);
    if (NS_FAILED(rv) || len == -1) {
        return ReportError(cx, LOAD_ERROR_NOCONTENT);
    }

    nsCString buf;
    rv = NS_ReadInputStreamToString(instream, buf, len);
    if (NS_FAILED(rv))
        return rv;

    /* we can't hold onto jsPrincipals as a module var because the
     * JSPRINCIPALS_DROP macro takes a JSContext, which we won't have in the
     * destructor */
    rv = principal->GetJSPrincipals(cx, &jsPrincipals);
    if (NS_FAILED(rv) || !jsPrincipals) {
        return ReportError(cx, LOAD_ERROR_NOPRINCIPALS);
    }

    /* set our own error reporter so we can report any bad things as catchable
     * exceptions, including the source/line number */
    er = JS_SetErrorReporter(cx, mozJSLoaderErrorReporter);

    if (charset) {
        nsString script;
        rv = ConvertToUTF16(
                nsnull, reinterpret_cast<const PRUint8*>(buf.get()), len,
                nsDependentString(reinterpret_cast<PRUnichar*>(charset)), script);

        if (NS_FAILED(rv)) {
            JSPRINCIPALS_DROP(cx, jsPrincipals);
            return ReportError(cx, LOAD_ERROR_BADCHARSET);
        }

        *scriptObjp =
            JS_CompileUCScriptForPrincipals(cx, target_obj, jsPrincipals,
                                            reinterpret_cast<const jschar*>(script.get()),
                                            script.Length(), uriStr, 1);
    } else {
        *scriptObjp =
            JS_CompileScriptForPrincipals(cx, target_obj, jsPrincipals, buf.get(),
                                          len, uriStr, 1);
    }

    JSPRINCIPALS_DROP(cx, jsPrincipals);

    /* repent for our evil deeds */
    JS_SetErrorReporter(cx, er);

    return NS_OK;
}

NS_IMETHODIMP /* args and return value are delt with using XPConnect and JSAPI */
dactylUtils::LoadSubScript (const PRUnichar * aURL
                            /* [, JSObject *target_obj] */)
{
    /*
     * Loads a local url and evals it into the current cx
     * Synchronous (an async version would be cool too.)
     *   url: The url to load.  Must be local so that it can be loaded
     *        synchronously.
     *   target_obj: Optional object to eval the script onto (defaults to context
     *               global)
     *   returns: Whatever jsval the script pointed to by the url returns.
     * Should ONLY (O N L Y !) be called from JavaScript code.
     */

    /* gotta define most of this stuff up here because of all the gotos,
     * defined the rest up here to be consistent */
    nsresult  rv;
    JSBool    ok;

#ifdef NS_FUNCTION_TIMER
    NS_TIME_FUNCTION_FMT("%s (line %d) (url: %s)", MOZ_FUNCTION_NAME,
                         __LINE__, NS_LossyConvertUTF16toASCII(aURL).get());
#else
    (void)aURL; // prevent compiler warning
#endif

    /* get JS things from the CallContext */
    nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
    if (!xpc) return NS_ERROR_FAILURE;

    nsAXPCNativeCallContext *cc = nsnull;
    rv = xpc->GetCurrentNativeCallContext(&cc);
    if (NS_FAILED(rv)) return NS_ERROR_FAILURE;

    JSContext *cx;
    rv = cc->GetJSContext (&cx);
    if (NS_FAILED(rv)) return NS_ERROR_FAILURE;

    PRUint32 argc;
    rv = cc->GetArgc (&argc);
    if (NS_FAILED(rv)) return NS_ERROR_FAILURE;

    jsval *argv;
    rv = cc->GetArgvPtr (&argv);
    if (NS_FAILED(rv)) return NS_ERROR_FAILURE;

    jsval *rval;
    rv = cc->GetRetValPtr (&rval);
    if (NS_FAILED(rv)) return NS_ERROR_FAILURE;

    /* set mJSPrincipals if it's not here already */
    if (!mSystemPrincipal)
    {
        nsCOMPtr<nsIScriptSecurityManager> secman =
            do_GetService(NS_SCRIPTSECURITYMANAGER_CONTRACTID);
        if (!secman)
            return rv;

        rv = secman->GetSystemPrincipal(getter_AddRefs(mSystemPrincipal));
        if (NS_FAILED(rv) || !mSystemPrincipal)
            return rv;
    }

    JSAutoRequest ar(cx);

    JSString *url;
    JSObject *target_obj = nsnull;
    jschar   *charset = nsnull;
    ok = JS_ConvertArguments (cx, argc, argv, "S / o W", &url, &target_obj, &charset);
    if (!ok)
    {
        /* let the exception raised by JS_ConvertArguments show through */
        return NS_OK;
    }

    JSAutoByteString urlbytes(cx, url);
    if (!urlbytes)
    {
        return NS_OK;
    }

    if (!target_obj)
    {
        /* if the user didn't provide an object to eval onto, find the global
         * object by walking the parent chain of the calling object */

        nsCOMPtr<nsIXPConnectWrappedNative> wn;
        rv = cc->GetCalleeWrapper (getter_AddRefs(wn));
        if (NS_FAILED(rv)) return NS_ERROR_FAILURE;

        rv = wn->GetJSObject (&target_obj);
        if (NS_FAILED(rv)) return NS_ERROR_FAILURE;

        JSObject *maybe_glob = JS_GetParent (cx, target_obj);
        while (maybe_glob != nsnull)
        {
            target_obj = maybe_glob;
            maybe_glob = JS_GetParent (cx, maybe_glob);
        }
    }

    // Remember an object out of the calling compartment so that we
    // can properly wrap the result later.
    nsCOMPtr<nsIPrincipal> principal = mSystemPrincipal;
    JSObject *result_obj = target_obj;
    target_obj = JS_FindCompilationScope(cx, target_obj);
    if (!target_obj)
        return NS_ERROR_FAILURE;

    if (target_obj != result_obj)
    {
        nsCOMPtr<nsIScriptSecurityManager> secman =
            do_GetService(NS_SCRIPTSECURITYMANAGER_CONTRACTID);
        if (!secman)
            return NS_ERROR_FAILURE;

        rv = secman->GetObjectPrincipal(cx, target_obj, getter_AddRefs(principal));
        NS_ENSURE_SUCCESS(rv, rv);
    }

    JSAutoEnterCompartment ac;
    if (!ac.enter(cx, target_obj))
        return NS_ERROR_UNEXPECTED;

    /* load up the url.  From here on, failures are reflected as ``custom''
     * js exceptions */
    nsCOMPtr<nsIURI> uri;
    nsCAutoString uriStr;
    nsCAutoString scheme;

    JSStackFrame* frame = nsnull;
    JSScript* script = nsnull;

    // Figure out who's calling us
    do
    {
        frame = JS_FrameIterator(cx, &frame);

        if (frame)
            script = JS_GetFrameScript(cx, frame);
    } while (frame && !script);

    if (!script)
    {
        // No script means we don't know who's calling, bail.

        return NS_ERROR_FAILURE;
    }

    nsCOMPtr<nsIIOService> serv = do_GetService(NS_IOSERVICE_CONTRACTID);
    if (!serv) {
        return ReportError(cx, LOAD_ERROR_NOSERVICE);
    }

    // Make sure to explicitly create the URI, since we'll need the
    // canonicalized spec.
    rv = NS_NewURI(getter_AddRefs(uri), urlbytes.ptr(), nsnull, serv);
    if (NS_FAILED(rv)) {
        return ReportError(cx, LOAD_ERROR_NOURI);
    }

    rv = uri->GetSpec(uriStr);
    if (NS_FAILED(rv)) {
        return ReportError(cx, LOAD_ERROR_NOSPEC);
    }

    rv = uri->GetScheme(scheme);
    if (NS_FAILED(rv)) {
        return ReportError(cx, LOAD_ERROR_NOSCHEME);
    }

    bool writeScript = false;
    JSScriptType *scriptObj = nsnull;
    JSVersion version = JS_GetVersion(cx);

    nsCAutoString cachePath;
    cachePath.Append("jssubloader/");
    cachePath.AppendInt(version);
    if (charset) {
        cachePath.Append("/");
        cachePath.Append(NS_ConvertUTF16toUTF8(
                    nsDependentString(reinterpret_cast<PRUnichar*>(charset))));
    }

    if (false)
        // This is evil. Very evil. Unfortunately, the PathifyURI symbol is
        // exported, but with an argument type that we don't have access to.
        PathifyURI(uri, *(nsACString_internal*)&cachePath);
    else {
        cachePath.Append("/");
        cachePath.Append(uriStr);
    }

    // Suppress caching if we're compiling as content.
    nsCOMPtr<nsIStartupCache> cache;
    if (mSystemPrincipal) {
        cache = do_GetService("@mozilla.org/startupcache/cache;1", &rv);
        NS_ENSURE_SUCCESS(rv, rv);
        rv = ReadCachedScript(cache, cachePath, cx, &scriptObj);
    }

    if (!scriptObj) {
        rv = ReadScript(uri, cx, target_obj, charset, (char *)uriStr.get(), serv,
                        principal, &scriptObj);
        writeScript = true;
    }

    if (NS_FAILED(rv) || !scriptObj)
        return rv;

    ok = false;
    if (scriptObj)
        ok = JS_ExecuteScriptVersion(cx, target_obj, scriptObj, rval, version);

    if (ok) {
        JSAutoEnterCompartment rac;
        if (!rac.enter(cx, result_obj) || !JS_WrapValue(cx, rval))
            return NS_ERROR_UNEXPECTED;
    }

    if (cache && ok && writeScript) {
        WriteCachedScript(cache, cachePath, cx, scriptObj);
    }

    cc->SetReturnValueWasSet (ok);
    return NS_OK;
}

