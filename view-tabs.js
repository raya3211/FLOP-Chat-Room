(() => {
  const tabs = Array.from(document.querySelectorAll(".view-tab"));
  const viewFeed = document.getElementById("view-feed");
  const viewPoems = document.getElementById("view-poems");
  const feedControls = document.getElementById("feed-controls");

  function activate(view) {
    for (const tab of tabs) {
      tab.classList.toggle("active", tab.dataset.view === view);
    }
    const showFeed = view === "feed";
    viewFeed.hidden = !showFeed;
    feedControls.hidden = !showFeed;
    viewPoems.hidden = showFeed;

    if (!showFeed) {
      window.dispatchEvent(new CustomEvent("technocore:poems-view-shown"));
    }
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => activate(tab.dataset.view));
  }

  activate("feed");
})();
