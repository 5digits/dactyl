#!/bin/sh
set -e

top=$(pwd)
jar=$1
bases=$2
dirs=$3
text=$4
bin=$5
shift 5;
files="$@"
HG=${HG:-hg}

stage="$top/${jar%.*}"
mkdir -p $stage

sed=$(which sed)
if [ "xoo" = x$(echo foo | sed -E 's/f(o)/\1/' 2>/dev/null) ]
then sed() { $sed -E "$@"; }
else sed() { $sed -r "$@"; }
fi

if $HG root >/dev/null 2>&1
then
    root="$($HG root)"
    which cygpath >/dev/null 2>&1 && root=$(cygpath $root)

    mf="$($HG --config ui.debug=false --config ui.verbose=false manifest)"
    find=$(which find)
    find() {
        $find "$@" -name '*.jar'
        echo "$mf" | sed -n "s!$(pwd | sed "s!$root/?!!")/?!!p" |
            grep "^$1"
        exit 1
    }
fi

getfiles() {
    filter="\.($(echo $1 | tr ' ' '|'))$"; shift
    find "$@" -not -path '*\.hg*' 2>/dev/null | grep -E "$filter" || true
}
copytext() {
    sed -e "s,@VERSION@,$VERSION,g" \
        -e "s,@DATE@,$BUILD_DATE,g" \
        <"$1" >"$2"
    cmp -s "$1" "$2" ||
    ( echo "modified: $1"; diff -u "$1" "$2" | grep '^[-+][^-+]' )
}

for base in $bases
do
    (
        set -e
        cd $base
        [ ${jar##*.} = jar ] && stage="$stage/${base##*/}"
        for dir in $dirs
        do
            for f in $(getfiles "$bin" "$dir")
            do
                mkdir -p "$stage/${f%/*}"
                cp $f "$stage/$f"
            done
            for f in $(getfiles "$text" "$dir")
            do
                mkdir -p "$stage/${f%/*}"
                copytext "$f" "$stage/$f"
            done
        done
        for f in $files
        do
            [ -f "$f" ] && copytext "$f" "$stage/$f"
        done
	true
    ) || exit 1
done

[ -f "$top/$jar" ] && rm -f "$top/$jar"
(set -e; cd $stage; zip -9r "$top/$jar" *) || exit 1
rm -rf "$stage"

# vim:se ft=sh sts=4 sw=4 et:
