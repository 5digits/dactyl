#!/bin/sh
set -e

fromrepo=
if [ "$1" = -r ]; then shift; fromrepo=1; fi

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
mkdir -p "$stage"

sed=$(which sed)
if [ "xoo" = x$(echo foo | sed -E 's/f(o)/\1/' 2>/dev/null) ]
then sed() { $sed -E "$@"; }
else sed() { $sed -r "$@"; }
fi

if test -n "$fromrepo" && $HG root >/dev/null 2>&1
then
    root="$($HG root)"
    which cygpath >/dev/null 2>&1 && root=$(cygpath $root)

    mf="$($HG --config ui.debug=false --config ui.verbose=false manifest)"
    find=$(which find)
    find() {
        echo "$mf" | sed -n "s!$(pwd | sed "s!$root/?!!")/?!!p" |
            grep "^$1"
        exit 1
    }
fi

mungeliterals=$(cat <<'!'
    local $/;
    $_ = <>;
    s{(?<!function )\bliteral\((?:function \(\) )?/\*(.*?)\*/\$?\)}{
        my $s = $1;
        $s =~ s/[\\']/\\$&/g;
        $s =~ s/\n/\\n\\$&/g;
        "/* Preprocessors FTW. */ '$s'";
    }ges;
    print;
!
)

mungeliterals() {
    if which perl >/dev/null 2>&1
    then perl -e "$mungeliterals"
    else cat
    fi
}

getfiles() {
    filter="\.($(echo $1 | tr ' ' '|'))$"; shift
    find "$@" -not -path '*\.hg*' 2>/dev/null | grep -E "$filter" || true
}
copytext() {
    mungeliterals <"$1" |
    sed -e "s,@VERSION@,$VERSION,g" \
        -e "s,@DATE@,$BUILD_DATE,g" \
        >"$2"
    cmp -s -- "$1" "$2" ||
    ( echo "modified: $1"; diff -u -- "$1" "$2" | grep '^[-+][^-+]' )
}

[ -f "$jar" ] && rm -f "$jar"
case "$jar" in
    /*) ;;
    *)
        [ -d "$jar" ] && rm -rf "$jar"
        jar="$top/$jar";;
esac

for base in $bases
do
    (
        set -e
        cd $base
        [ ${jar##*.} != xpi ] && stage="$stage/${base##*/}"
        for dir in $dirs
        do
            for f in $(getfiles "$bin" "$dir")
            do
                mkdir -p "$stage/${f%/*}"
                cp -- "$f" "$stage/$f"
            done
            for f in $(getfiles "$text" "$dir")
            do
                mkdir -p "$stage/${f%/*}"
                copytext "$f" "$stage/$f"
            done
        done
        for f in $files
        do
            if [ -f "$f" ]
            then
                case "$f" in
                *.js|*.jsm|*.css|*.dtd|*.xml|*.xul|*.html|*.xhtml|*.xsl|*.properties|*.json)
                    copytext "$f" "$stage/$f";;
                *)
                    cp -- "$f" "$stage/$f";;
                esac
            fi
        done
	true
    ) || exit 1
done

(
    set -e;
    cd "$stage";
    case "$jar" in
    (*/) if [ "$stage" != "$jar" ]; then mv -- * "$jar"; fi;;
    (*)  zip -9r "$jar" -- *;;
    esac
) || exit 1

[ "$stage" != "$jar" ] && rm -rf "$stage"
true

# vim:se ft=sh sts=4 sw=4 et:
