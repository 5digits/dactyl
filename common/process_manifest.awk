BEGIN { if (!chrome) chrome = "chrome" }
{ content = $1 ~ /^(content|skin|locale|resource)$/ }
content && $NF ~ /^[a-z]/ { $NF = "/" name "/" $NF }
content {
    sub(/^\.\./, "", $NF);
    if (isjar)
	    $NF = "jar:chrome/" name ".jar!" $NF
    else
	    $NF = chrome $NF
}
{
    sub("^\\.\\./common/", "", $NF)
    print
}

