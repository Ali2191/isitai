// IsItAI browser extension — right-click any image → open the report page.
// Acquisition channel: detection happens on isitai.app (URL mode), so the
// extension itself stays trivial and passes store review easily.

const SITE = 'https://isitai-gilt.vercel.app'

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'isitai-detect-image',
    title: 'Detect with IsItAI',
    contexts: ['image'],
  })
  chrome.contextMenus.create({
    id: 'isitai-detect-page',
    title: 'IsItAI — open detector',
    contexts: ['page'],
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.srcUrl || info.linkUrl
  const target = url
    ? `${SITE}/?url=${encodeURIComponent(url)}&auto=1`
    : SITE
  chrome.tabs.create({ url: target, active: true })
})
