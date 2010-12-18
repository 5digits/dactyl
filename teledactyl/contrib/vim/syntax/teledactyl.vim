" Vim syntax file
" Language:         Teledactyl configuration file
" Maintainer:       Doug Kearns <dougkearns@gmail.com>

" TODO: make this teledactyl specific - shared dactyl config?

if exists("b:current_syntax")
  finish
endif

let s:cpo_save = &cpo
set cpo&vim

syn include @javascriptTop syntax/javascript.vim
unlet b:current_syntax

syn include @cssTop syntax/css.vim
unlet b:current_syntax

syn match teledactylCommandStart "\%(^\s*:\=\)\@<=" nextgroup=teledactylCommand,teledactylAutoCmd

syn keyword teledactylCommand run ab[breviate] abc[lear] addo[ns] au[tocmd] bd[elete] bw[ipeout] bun[load] tabc[lose]
    \ ca[bbrev] cabc[lear] cd chd[ir] cm[ap] cmapc[lear] cno[remap] colo[rscheme] comc[lear] com[mand] con[tact] contacts
    \ addr[essbook] contexts copy[to] cuna[bbrev] cunm[ap] delc[ommand] delmac[ros] delm[arks] dels[tyle] dia[log] doautoa[ll]
    \ do[autocmd] ec[ho] echoe[rr] echom[sg] el[se] elsei[f] elif em[enu] empty[trash] en[dif] fi exe[cute] exta[dd] extde[lete]
    \ extd[isable] exte[nable] extens[ions] exts exto[ptions] extp[references] extu[pdate] exu[sage] fini[sh] frameo[nly]
    \ get[messages] go[to] ha[rdcopy] h[elp] helpa[ll] hi[ghlight] ia[bbrev] iabc[lear] if im[ap] imapc[lear] ino[remap]
    \ iuna[bbrev] iunm[ap] javas[cript] js keepa[lt] let loadplugins lpl macros m[ail] map mapc[lear] ma[rk] marks mes[sages]
    \ messc[lear] mkt[eledactylrc] move[to] nm[ap] nmapc[lear] nno[remap] noh[lsearch] no[remap] norm[al] nunm[ap] optionu[sage]
    \ pa[geinfo] pagest[yle] pas pref[erences] prefs pw[d] q[uit] re[load] res[tart] runt[ime] sav[eas] w[rite] scrip[tnames]
    \ se[t] setg[lobal] setl[ocal] sil[ent] so[urce] st[op] sty[le] styled[isable] styd[isable] stylee[nable] stye[nable]
    \ stylet[oggle] styt[oggle] tab tabd[o] bufd[o] tabl[ast] bl[ast] tabn[ext] tn[ext] bn[ext] tabp[revious] tp[revious]
    \ tabN[ext] tN[ext] bp[revious] bN[ext] tabr[ewind] tabfir[st] br[ewind] bf[irst] time tm[ap] tmapc[lear] tno[remap] tunm[ap]
    \ una[bbreviate] unl[et] unm[ap] verb[ose] ve[rsion] vie[wsource] viu[sage] vm[ap] vmapc[lear] vno[remap] vunm[ap] y[ank]
    \ zo[om]
    \ contained

syn match teledactylCommand "!" contained

syn keyword teledactylAutoCmd au[tocmd] contained nextgroup=teledactylAutoEventList skipwhite

syn keyword teledactylAutoEvent DOMLoad FolderLoad PageLoadPre PageLoad Enter Leave LeavePre contained

syn match teledactylAutoEventList "\(\a\+,\)*\a\+" contained contains=teledactylAutoEvent

syn region teledactylSet matchgroup=teledactylCommand start="\%(^\s*:\=\)\@<=\<\%(setl\%[ocal]\|setg\%[lobal]\|set\=\)\=\>"
    \ end="$" keepend oneline contains=teledactylOption,teledactylString

syn keyword teledactylOption altwildmode awim archivefolder autocomplete au cdpath cd complete cpt editor eventignore ei
    \ extendedhinttags eht fileencoding fenc followhints fh guioptions go helpfile hf hintinputs hin hintkeys hk hintmatching hm
    \ hinttags ht hinttimeout hto history hi layout loadplugins lpl mapleader ml maxitems messages msgs nextpattern pageinfo pa
    \ passkeys pk previouspattern runtimepath rtp scroll scr shell sh shellcmdflag shcf showstatuslinks ssli showtabline stal
    \ titlestring urlseparator urlsep us verbose vbs wildanchor wia wildcase wic wildignore wig wildmode wim wildsort wis
    \ wordseparators wsp
    \ contained nextgroup=teledactylSetMod

let s:toggleOptions = ["autoexternal", "ae", "banghist", "bh", "errorbells", "eb", "exrc", "ex", "fullscreen", "fs",
    \ "hlsearch", "hls", "incsearch", "is", "insertmode", "im", "jsdebugger", "jsd", "more", "online", "searchcase", "sc",
    \ "showmode", "smd", "strictfocus", "sf", "usermode", "um", "visualbell", "vb"]
execute 'syn match teledactylOption "\<\%(no\|inv\)\=\%(' .
    \ join(s:toggleOptions, '\|') .
    \ '\)\>!\=" contained nextgroup=teledactylSetMod'

syn match teledactylSetMod "\%(\<[a-z_]\+\)\@<=&" contained

syn region teledactylJavaScript start="\%(^\s*\%(javascript\|js\)\s\+\)\@<=" end="$" contains=@javascriptTop keepend oneline
syn region teledactylJavaScript matchgroup=teledactylJavaScriptDelimiter
    \ start="\%(^\s*\%(javascript\|js\)\s\+\)\@<=<<\s*\z(\h\w*\)"hs=s+2 end="^\z1$" contains=@javascriptTop fold

let s:cssRegionStart = '\%(^\s*sty\%[le]!\=\s\+\%(-\%(n\|name\)\%(\s\+\|=\)\S\+\s\+\)\=[^-]\S\+\s\+\)\@<='
execute 'syn region teledactylCss start="' . s:cssRegionStart . '" end="$" contains=@cssTop keepend oneline'
execute 'syn region teledactylCss matchgroup=teledactylCssDelimiter'
    \ 'start="' . s:cssRegionStart . '<<\s*\z(\h\w*\)"hs=s+2 end="^\z1$" contains=@cssTop fold'

syn match teledactylNotation "<[0-9A-Za-z-]\+>"

syn match   teledactylComment +".*$+ contains=teledactylTodo,@Spell
syn keyword teledactylTodo FIXME NOTE TODO XXX contained

syn region teledactylString start="\z(["']\)" end="\z1" skip="\\\\\|\\\z1" oneline

syn match teledactylLineComment +^\s*".*$+ contains=teledactylTodo,@Spell

" NOTE: match vim.vim highlighting group names
hi def link teledactylAutoCmd               teledactylCommand
hi def link teledactylAutoEvent             Type
hi def link teledactylCommand               Statement
hi def link teledactylComment               Comment
hi def link teledactylJavaScriptDelimiter   Delimiter
hi def link teledactylCssDelimiter          Delimiter
hi def link teledactylNotation              Special
hi def link teledactylLineComment           Comment
hi def link teledactylOption                PreProc
hi def link teledactylSetMod                teledactylOption
hi def link teledactylString                String
hi def link teledactylTodo                  Todo

let b:current_syntax = "teledactyl"

let &cpo = s:cpo_save
unlet s:cpo_save

" vim: tw=130 et ts=4 sw=4:
