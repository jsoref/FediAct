var browser, chrome, settings
const enableConsoleLog = true
const logPrepend = "[FediAct]"
const tokenInterval = 1 // minutes
const mutesApi = "/api/v1/mutes"
const blocksApi = "/api/v1/blocks"
const domainBlocksApi = "/api/v1/domain_blocks"

const tokenRegex = /"access_token":".*?",/gm

// required settings keys with defauls
const settingsDefaults = {
	fediact_homeinstance: null
}

// wrapper to prepend to log messages
function log(text) {
	if (enableConsoleLog) {
		console.log(logPrepend + ' ' + text)
	}
}

// get redirect url (it will be the url on the toot authors home instance)
async function resolveToot(url) {
    return new Promise(async function(resolve) {
        try {
            var res = await fetch(url, {method: 'HEAD'})
            if (res.redirected) {
                resolve(res.url)
            } else {
                resolve(false)
            }
        } catch(e) {
            log(e)
            resolve(false)
        }
    })
}

// fetch API token here (will use logged in session automatically)
async function fetchBearerToken() {
    return new Promise(async function(resolve) {
        var url = "https://" + settings.fediact_homeinstance
        try {
            var res = await fetch(url)
            var text = await res.text()
        } catch(e) {
            log(e)
            resolve(false)
            return
        }
        if (text) {
            // dom parser is not available in background workers, so we use regex to parse the html....
            // for some reason, regex groups do also not seem to work in chrome background workers... the following is ugly but should work fine
            var content = text.match(tokenRegex)
            if (content) {
                var indexOne = content[0].search(/"access_token":"/)
                var indexTwo = content[0].search(/",/)
                if (indexOne > -1 && indexTwo > -1) {
                    indexOne = indexOne + 16
                    var token = content[0].substring(indexOne, indexTwo)
                    if (token.length > 16) {
                        settings.fediact_token = token
                        resolve(true)
                        return
                    }
                }
            }
        }
        // reset token for inject.js to know
        settings.fediact_token = null
        log("Token could not be found.")
        resolve(false)
    })
}

// grab all accounts/instances that are muted/blocked by the user
// this is only done here in the bg script so we have data available on load of pages without first performing 3 (!) requests
// otherwise this would lead to problems with element detection / low performance (espcially v3 instances)
// mutes/blocks are updated in content script on page context changes and after performing mutes/block actions
async function fetchMutesAndBlocks() {
    return new Promise(async function(resolve) {
        // set empty initially
        [settings.fediact_mutes, settings.fediact_blocks, settings.fediact_domainblocks] = [[],[],[]]
        var [mutes, blocks, domainblocks] = await Promise.all([
            fetch("https://" + settings.fediact_homeinstance + mutesApi, {headers: {"Authorization": "Bearer "+settings.fediact_token}}).then((response) => response.json()),
            fetch("https://" + settings.fediact_homeinstance + blocksApi, {headers: {"Authorization": "Bearer "+settings.fediact_token}}).then((response) => response.json()),
            fetch("https://" + settings.fediact_homeinstance + domainBlocksApi, {headers: {"Authorization": "Bearer "+settings.fediact_token}}).then((response) => response.json())
        ])
        if (mutes.length) {
            settings.fediact_mutes.push(...mutes.map(acc => acc.acct))
        }
        if (blocks.length) {
            settings.fediact_blocks.push(...blocks.map(acc => acc.acct))
        }
        if (domainblocks.length) {
            settings.fediact_domainblocks = domainblocks
        }
        resolve(true)
    })
}

async function fetchData() {
    return new Promise(async function(resolve) {
        try {
            settings = await (browser || chrome).storage.local.get(settingsDefaults)
        } catch(e) {
            log(e)
            resolve(false)
            return
        }
        if (settings.fediact_homeinstance) {
            await fetchBearerToken()
            await fetchMutesAndBlocks()
        } else {
            log("Home instance not set")
            resolve(false)
            return
        }
        try {
            await (browser || chrome).storage.local.set(settings)
            resolve(true)
        } catch {
            log(e)
        }
    })
}

async function reloadListeningScripts() {
    chrome.tabs.query({}, async function(tabs) {
        for (var i=0; i<tabs.length; ++i) {
            try {
                chrome.tabs.sendMessage(tabs[i].id, {updatedfedisettings: true})
            } catch(e) {
                // all non-listening tabs will throw an error, we can ignore it
                continue
            }
        }
    })
}

// fetch api token right after install (mostly for debugging, when the ext. is reloaded)
chrome.runtime.onInstalled.addListener(fetchData)
// and also every 3 minutes
chrome.alarms.create('refresh', { periodInMinutes: tokenInterval })
chrome.alarms.onAlarm.addListener(fetchData)

// different listeners for inter-script communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // the content script gave us an url to perform a 302 redirect with
    if(request.url) {
        resolveToot(request.url).then(sendResponse)
        return true
    }
    // immediately fetch api token after settings are updated
    if (request.updatedsettings) {
        fetchData().then(reloadListeningScripts)
        return true
    }
    // when the content script starts to process on a site, listen for tab changes (url)
    if (request.running) {
        chrome.tabs.onUpdated.addListener(async function(tabId, changeInfo, tab) {
            // chrome tabs api does not support listener filters here
            // if the tabId of the update event is the same like the tabId that started the listener in the first place AND when the update event is an URL
            if (tabId === sender.tab.id && changeInfo.url) {
                // ... then let the content script know about the change
                try {
                    await chrome.tabs.sendMessage(tabId, {urlchanged: changeInfo.url})
                } catch(e) {
                    log(e)
                }
            }
        })
    }
})