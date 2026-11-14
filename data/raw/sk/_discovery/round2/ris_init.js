var ua = window.navigator.userAgent;
if(ua.match(/MSIE\s([0-8]{1})\.0\;/)) {
    parent.location.href='browser-not-supported.html';
}

var sankeySide = null;
function changeSankeySide(brightSide) {
	sankeySide = brightSide;
}

function get_eu_accept_cookies(lang) {
	eu_accept_cookies.panel(lang);
}