// prep
const buttonPaths = ["div.account__header button.logo-button","div.public-account-header a.logo-button"];
const namePaths = ["div.account__header div.account__header__tabs__name small","div.public-account-header div.public-account-header__tabs__name small"]
const domainRegex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/;
const handleRegex = /^(?:https?:\/\/(www\.)?.*\..*?\/)(?<handle>@\w+(?:@\w+\.\w+)?)\/?$/;
const enableConsoleLog = true;
const logPrepend = "[FediFollow]";
const maxElementWaitFactor = 200; // x 100ms for total time

var lastUrl = window.location.href;

// settings keys with defauls
var settings = {
	fedifollow_homeinstance: null,
	fedifollow_alert: false,
	fedifollow_mode: "blacklist",
	fedifollow_whitelist: null,
	fedifollow_blacklist: null,
	fedifollow_target: "_blank"
}

// fix for cross-browser storage api compatibility
var browser, chrome;

// wrappers to prepend to log messages
function log(text) {
	if (enableConsoleLog) {
		console.log(logPrepend + ' ' + text)
	}
}
function logerr(error) {
	if (enableConsoleLog) {
		console.error(logPrepend + ' Error: ' + error)
	}
}

// function to wait for given elements to appear - first found element gets returned (but as of now the selectors are for different layouts anyways)
var waitForEl = function(counter, selectors, callback) {
	var match = false;
	// check all of the selectors
	for (const selector of selectors) {
		// if found
		if ($(selector).length) {
			// set match = true to prevent repetition hand over the found element
			match = true;
			callback(selector);
		}
	}
	// repeat if no match was found and we did not exceed the wait factor yet
	if (!match && counter < maxElementWaitFactor) {
	    setTimeout(function() {
				// increase counter
        waitForEl(counter + 1, selectors, callback);
      }, 100);
	}
};

// extract handle from elements
function extractHandle(selectors) {
	// check all of the selectors
	for (const selector of selectors) {
		// if found
		if ($(selector).length) {
			return $(selector).text().trim();
		}
	}
	return false;
}

function processDomainList(newLineList) {
	// split by new line
	var arrayFromList = newLineList.split(/\r?\n/);
	// array to put checked domains into
	var cleanedArray = [];
	for (var domain of arrayFromList) {
		// remove whitespace
		domain = domain.trim();
		if (domainRegex.test(domain)) {
			cleanedArray.push(domain)
		} else {
			log("Removed invalid domain " + domain + " from blacklist/whitelist.")
		}
	}
	// return newly created set (remvoes duplicates)
	return [...new Set(cleanedArray)];;
}

function runWithSettings(settings) {

	function checkSettings() {
		// if the home instance is undefined/null/empty
		if (settings.fedifollow_homeinstance == null || !settings.fedifollow_homeinstance) {
			log("Mastodon home instance is not set.");
			return false;
		}
		// if the value looks like a domain...
		if (!(domainRegex.test(settings.fedifollow_homeinstance))) {
			log("Instance setting is not a valid domain name.");
			return false;
		}
		// set default if wrong value
		if ($.inArray(settings.fedifollow_mode, ["blacklist","whitelist"]) < 0) {
			settings.fedifollow_mode = "blacklist";
		}
		if ($.inArray(settings.fedifollow_target, ["_blank","_self"]) < 0) {
			settings.fedifollow_target = "_blank";
		}
		if (settings.fedifollow_mode == "whitelist") {
			// if in whitelist mode and the cleaned whitelist is empty, return false
			settings.fedifollow_whitelist = processDomainList(settings.fedifollow_whitelist);
			if (settings.fedifollow_whitelist.length < 1) {
				log("Whitelist is empty or invalid.")
				return false;
			}
		} else {
			// also process the blacklist if in blacklist mode, but an empty blacklist is OK so we do not return false
			settings.fedifollow_blacklist = processDomainList(settings.fedifollow_blacklist);
		}
		return true;
	}

	// main function to listen for the follow button pressed and open a new tab with the home instance
	function processSite() {
		// check if we have a handle in the url
		if (handleRegex.test(window.location.href)) {
			// wait until follow button appears (document is already ready, but most content is loaded afterwards)
			waitForEl(0, buttonPaths, function(found) {
				if (found) {
					var handle = extractHandle(namePaths);
					if (handle) {
						// setup the button click listener
						$(found).click(function(e) {
							// prevent default action and other handlers
							e.preventDefault();
							e.stopImmediatePropagation();
							// check the alert setting and show it if set
							if (settings.fedifollow_alert) {
								alert("Redirecting to "+settings.fedifollow_homeinstance);
							}
							// backup the button text
							var originaltext = $(found).text();
							// replace the button text to indicate redirection
							$(found).text("Redirecting...");
							// timeout 1000ms to make it possible to notice the redirection indication
							setTimeout(function() {
								// if more than 1 @, we have a domain in the handle
								if ((handle.match(/@/g) || []).length > 1) {
									// but if its our own...
									if (handle.includes(settings.fedifollow_homeinstance)) {
										// ...then we need to remove it
										handle = "@"+ handle.split("@")[1];
									}
									// request string
									var request = 'https://'+settings.fedifollow_homeinstance+'/'+handle;
								} else {
									// with only 1 @, we have a local handle and need to append the domain
									// this should in fact not happen since the account-header should always include the full handle, not local only, unlike the URL
									// in some cases, appending the full domain (including subdomains) will not work
									// since some instances run on a subdomain but do not use the subdomain for user handles (ex. mastodon.pub.solar)
									var request = 'https://'+settings.fedifollow_homeinstance+'/'+handle+'@'+document.domain;
								}
								// open the window
								var win = window.open(request, settings.fedifollow_target);
								log("Redirected to " + request)
								// focus the new tab if open was successfull
								if (win) {
									win.focus();
								} else {
									// otherwise notify user...
									log('Could not open new window. Please allow popups for this website.');
								}
								// restore original button text
								$(found).text(originaltext);
							}, 1000);
						});
					} else {
						log("Could not find a user handle.");
					}
				} else {
					log("Could not find any follow button.");
				}
			});
		} else {
			log("Not a profile URL.");
		}
	}

	// test if the current site should be processed or not
	// this will also be the function for whitelist/blacklist feature
	function checkSite() {
		// is this site on our home instance?
		if (document.domain == settings.fedifollow_homeinstance) {
			log("Current site is your home instance.");
			return false;
		}
		if (settings.fedifollow_mode == "whitelist") {
			if ($.inArray(document.domain, settings.fedifollow_whitelist) < 0) {
				log("Current site is not in whitelist.");
				return false;
			}
		} else {
			if ($.inArray(document.domain, settings.fedifollow_blacklist) > -1) {
				log("Current site is in blacklist.");
				return false;
			}
		}
		// check if the current site looks like Mastodon
		$(document).ready(function() {
			if (!($("head").text().includes("mastodon") || $("head").text().includes("Mastodon") || $("div#mastodon").length)) {
				log("Could not find a reference that this is a Mastodon site.")
				return false;
			}
		});
		return true;
	}

	// for some reason, locationchange event did not work for me so lets use this ugly thing... since it calls processSite, it needs to be in runWithSettings as well
	function urlChangeLoop() {
		// run every 100ms, can probably be reduced
		setTimeout(function() {
			// compare last to current url
			if (!(lastUrl == window.location.href)) {
				// update lastUrl and run main script
				lastUrl = window.location.href;
				processSite();
			}
			// repeat
			urlChangeLoop();
		}, 300);
	}

	// check and process settings
	if (checkSettings()) {
		// check if the current URL should be processed
		if (checkSite()) {
			// ... run the actual script (once for the start and then in a loop depending on url changes)
			processSite();
			urlChangeLoop();
		} else {
			log("Will not process this URL.")
		}
	}

}

(browser || chrome).storage.local.get(settings).then(runWithSettings, logerr);
