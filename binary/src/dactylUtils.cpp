/*
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
 * Contributors, possibly:
 *   Kris Maglione <maglione.k at Gmail>
 *   Jeff Walden <jwalden@mit.edu>
 *   Mike Shaver <shaver@zeroknowledge.com>
 *   John Bandhauer <jband@netscape.com>
 *   Robert Ginda <rginda@netscape.com>
 *   Pierre Phaneuf <pp@ludusdesign.com>
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
 * ***** END LICENSE BLOCK *****
 */

#include "dactylUtils.h"

#include "jsdbgapi.h"
#include "jsobj.h"

#include "nsIObserverService.h"
#include "nsIScriptSecurityManager.h"
#include "nsIXPCScriptable.h"

#include "nsComponentManagerUtils.h"
#include "nsServiceManagerUtils.h"
#include "nsStringAPI.h"


class autoDropPrincipals {
public:
	autoDropPrincipals(JSContext *context, JSPrincipals *principals) : mContext(context), mJSPrincipals(principals) {}
	~autoDropPrincipals() {
        JSPRINCIPALS_DROP(mContext, mJSPrincipals);
    }

private:
    JSContext *mContext;
    JSPrincipals *mJSPrincipals;
};

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

static JSFunctionSpec gGlobalFun[] = {
    {"dump",    Dump,   1,0},
    {nsnull,nsnull,0,0}
};

static dactylUtils* gService = nsnull;

dactylUtils::dactylUtils()
	: mRuntime(nsnull)
{
	NS_ASSERTION(gService == nsnull, "Service already exists");
}

dactylUtils::~dactylUtils()
{
    mRuntimeService = nsnull;
    gService = nsnull;
}

nsresult
dactylUtils::Init()
{
	nsresult rv;
	NS_ENSURE_TRUE(!gService, NS_ERROR_UNEXPECTED);

    mRuntimeService = do_GetService("@mozilla.org/js/xpc/RuntimeService;1", &rv);
	NS_ENSURE_SUCCESS(rv, rv);

    rv = mRuntimeService->GetRuntime(&mRuntime);
	NS_ENSURE_SUCCESS(rv, rv);

    nsCOMPtr<nsIScriptSecurityManager> secman =
        do_GetService(NS_SCRIPTSECURITYMANAGER_CONTRACTID);
    NS_ENSURE_TRUE(secman, NS_ERROR_FAILURE);

    rv = secman->GetSystemPrincipal(getter_AddRefs(mSystemPrincipal));
    NS_ENSURE_TRUE(rv, rv);
    NS_ENSURE_TRUE(mSystemPrincipal, NS_ERROR_FAILURE);

    return NS_OK;
}

NS_IMPL_ISUPPORTS1(dactylUtils,
                   dactylIUtils)

NS_IMETHODIMP
dactylUtils::CreateGlobal(JSContext *cx, jsval *out)
{
    nsresult rv;

    // JS::AutoPreserveCompartment pc(cx);

    nsCOMPtr<nsIXPCScriptable> backstagePass;
    rv = mRuntimeService->GetBackstagePass(getter_AddRefs(backstagePass));
    NS_ENSURE_SUCCESS(rv, rv);

    nsCOMPtr<nsIXPConnect> xpc =
        do_GetService("@mozilla.org/js/xpc/XPConnect;1", &rv);
    NS_ENSURE_SUCCESS(rv, rv);

    // Make sure InitClassesWithNewWrappedGlobal() installs the
    // backstage pass as the global in our compilation context.
    JS_SetGlobalObject(cx, nsnull);

    nsCOMPtr<nsIXPConnectJSObjectHolder> holder;
    rv = xpc->InitClassesWithNewWrappedGlobal(cx, backstagePass,
                                              NS_GET_IID(nsISupports),
                                              mSystemPrincipal,
                                              nsnull,
                                              nsIXPConnect::
                                                  FLAG_SYSTEM_GLOBAL_OBJECT,
                                              getter_AddRefs(holder));
    NS_ENSURE_SUCCESS(rv, rv);

    JSObject *global;
    rv = holder->GetJSObject(&global);
    NS_ENSURE_SUCCESS(rv, rv);

    JSAutoEnterCompartment ac;
    NS_ENSURE_TRUE(ac.enter(cx, global), NS_ERROR_FAILURE);

    NS_ENSURE_TRUE(JS_DefineFunctions(cx, global, gGlobalFun),
                   NS_ERROR_FAILURE);
    NS_ENSURE_TRUE(JS_DefineProfilingFunctions(cx, global),
                   NS_ERROR_FAILURE);

    *out = OBJECT_TO_JSVAL(global);
}

NS_IMETHODIMP
dactylUtils::EvalInContext(const nsAString &aSource,
                           const jsval &aTarget,
                           const nsACString &aFilename,
                           PRInt32 aLineNumber,
                           JSContext *cx,
                           jsval *rval)
{
    nsresult rv;

    nsCOMPtr<nsIXPConnect> xpc(do_GetService(nsIXPConnect::GetCID(), &rv));
    NS_ENSURE_SUCCESS(rv, rv);

    nsCString filename;

    if (!aFilename.IsEmpty())
        filename.Assign(aFilename);
    else {
        nsCOMPtr<nsIStackFrame> frame;
        xpc->GetCurrentJSStack(getter_AddRefs(frame));
        NS_ENSURE_TRUE(frame, NS_ERROR_FAILURE);
        frame->GetFilename(getter_Copies(filename));
        frame->GetLineNumber(&aLineNumber);
    }

    JSObject *target;
    NS_ENSURE_FALSE(JSVAL_IS_PRIMITIVE(aTarget), NS_ERROR_UNEXPECTED);
    target = JSVAL_TO_OBJECT(aTarget);


    JSObject *result = target;
    target = JS_FindCompilationScope(cx, target);
    NS_ENSURE_TRUE(target, NS_ERROR_FAILURE);


    nsCOMPtr<nsIScriptSecurityManager> secman =
        do_GetService(NS_SCRIPTSECURITYMANAGER_CONTRACTID);
    NS_ENSURE_TRUE(secman, NS_ERROR_FAILURE);

    nsCOMPtr<nsIPrincipal> principal;
    rv = secman->GetObjectPrincipal(cx, target, getter_AddRefs(principal));
    NS_ENSURE_SUCCESS(rv, rv);


    JSPrincipals *jsPrincipals;
    rv = principal->GetJSPrincipals(cx, &jsPrincipals);
    NS_ENSURE_SUCCESS(rv, rv);
    autoDropPrincipals adp(cx, jsPrincipals);

    JSObject *callingScope;
    {
        JSAutoRequest req(cx);

        callingScope = JS_GetScopeChain(cx);
        NS_ENSURE_TRUE(callingScope, NS_ERROR_FAILURE);
        callingScope = JS_GetGlobalForObject(cx, callingScope);
    }

    {
        JSAutoRequest req(cx);
        JSAutoEnterCompartment ac;
        jsval v;

        NS_ENSURE_TRUE(ac.enter(cx, target), NS_ERROR_FAILURE);

        JSBool ok =
            JS_EvaluateUCScriptForPrincipals(cx, target,
                                             jsPrincipals,
                                             reinterpret_cast<const jschar*>
                                                (PromiseFlatString(aSource).get()),
                                             aSource.Length(),
                                             filename.get(), aLineNumber, &v);

        if (!ok) {
            jsval exn;
            if (!JS_GetPendingException(cx, &exn))
                rv = NS_ERROR_FAILURE;
            else {
                JS_ClearPendingException(cx);

                if (JS_WrapValue(cx, &exn))
                    JS_SetPendingException(cx, exn);
            }
        }
        else {
            // Convert the result into something safe for our caller.
            JSAutoRequest req(cx);
            JSAutoEnterCompartment ac;

            if (!ac.enter(cx, callingScope) || !JS_WrapValue(cx, &v))
                rv = NS_ERROR_FAILURE;

            if (NS_SUCCEEDED(rv))
                *rval = v;
        }
    }

    return rv;
}

NS_IMETHODIMP
dactylUtils::GetGlobalForObject(const jsval &aObject,
                                JSContext *cx,
                                jsval *rval)
{
    nsresult rv;

    NS_ENSURE_FALSE(JSVAL_IS_PRIMITIVE(aObject),
                    NS_ERROR_XPC_BAD_CONVERT_JS);

    JSObject *obj = JSVAL_TO_OBJECT(aObject);
    if (obj->isProxy())
        obj = obj->unwrap();

    JSObject *global = JS_GetGlobalForObject(cx, obj);
    *rval = OBJECT_TO_JSVAL(global);

    // Outerize if necessary.
    if (JSObjectOp outerize = global->getClass()->ext.outerObject)
        *rval = OBJECT_TO_JSVAL(outerize(cx, global));

    return NS_OK;
}

/* vim:se sts=4 sw=4 et ft=cpp: */
