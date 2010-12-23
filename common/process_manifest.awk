{ content = $1 ~ /^(content|skin|locale)$/ }
content && $NF ~ /^[a-z]/ { $NF = "/" name "/" $NF }
content {
    sub(/^\.\./, "", $NF);
    if (isjar)
	    $NF = "jar:chrome/" name ".jar!" $NF
    else
	    $NF = "chrome" $NF
}
{
    sub("^\\.\\./common/", "", $NF)
    print
}

