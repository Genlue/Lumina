// ============================================================
// Photo Album — Application State (encapsulated)
// ============================================================

const State = (() => {
  /** @type {string|null} */
  let _profileId = null;
  let _profileFolder = null;
  let _profileName = null;

  /** @type {Array<{name:string,size:number,lastModified:number,_key?:string,_folder?:string|null}>} */
  let _rootImages = [];
  let _albumFolders = [];
  /** @type {Record<string, Array>} */
  let _albumImages = {};
  let _bgImages = [];
  let _filteredImages = [];

  let _currentView = 'all';
  let _selected = new Set();
  let _multiselect = false;
  let _currentPage = 'home';
  let _discoverTab = 'waterfall';

  // Lightbox
  let _lbIdx = -1, _lbZoom = 1, _lbPanX = 0, _lbPanY = 0;
  let _lbDragging = false, _lbDragX = 0, _lbDragY = 0, _lbDidDrag = false;

  // Random mode
  let _randomTimer = null, _randomPaused = false;
  let _randomImgs = null, _randomIdx = 0;

  // Favorites
  let _favoritesList = [];
  let _favoritesSet = new Set();

  // Search
  let _searchAlbumMatchType = {};

  const api = {
    get profileId() { return _profileId; },
    set profileId(v) { _profileId = v; },
    get profileFolder() { return _profileFolder; },
    set profileFolder(v) { _profileFolder = v; },
    get profileName() { return _profileName; },
    set profileName(v) { _profileName = v; },

    get rootImages() { return _rootImages; },
    set rootImages(v) { _rootImages = v; },
    get albumFolders() { return _albumFolders; },
    set albumFolders(v) { _albumFolders = v; },
    get albumImages() { return _albumImages; },
    set albumImages(v) { _albumImages = v; },
    get bgImages() { return _bgImages; },
    set bgImages(v) { _bgImages = v; },
    get filteredImages() { return _filteredImages; },
    set filteredImages(v) { _filteredImages = v; },

    get currentView() { return _currentView; },
    set currentView(v) { _currentView = v; },
    get selected() { return _selected; },
    get multiselect() { return _multiselect; },
    set multiselect(v) { _multiselect = v; },
    get currentPage() { return _currentPage; },
    set currentPage(v) { _currentPage = v; },
    get discoverTab() { return _discoverTab; },
    set discoverTab(v) { _discoverTab = v; },

    get lbIdx() { return _lbIdx; },
    set lbIdx(v) { _lbIdx = v; },
    get lbZoom() { return _lbZoom; },
    set lbZoom(v) { _lbZoom = v; },
    get lbPanX() { return _lbPanX; },
    set lbPanX(v) { _lbPanX = v; },
    get lbPanY() { return _lbPanY; },
    set lbPanY(v) { _lbPanY = v; },
    get lbDragging() { return _lbDragging; },
    set lbDragging(v) { _lbDragging = v; },
    get lbDragX() { return _lbDragX; },
    set lbDragX(v) { _lbDragX = v; },
    get lbDragY() { return _lbDragY; },
    set lbDragY(v) { _lbDragY = v; },
    get lbDidDrag() { return _lbDidDrag; },
    set lbDidDrag(v) { _lbDidDrag = v; },

    get randomTimer() { return _randomTimer; },
    set randomTimer(v) { _randomTimer = v; },
    get randomPaused() { return _randomPaused; },
    set randomPaused(v) { _randomPaused = v; },
    get _randomImgs() { return _randomImgs; },
    set _randomImgs(v) { _randomImgs = v; },
    get _randomIdx() { return _randomIdx; },
    set _randomIdx(v) { _randomIdx = v; },

    get favoritesList() { return _favoritesList; },
    set favoritesList(v) { _favoritesList = v; },
    get favoritesSet() { return _favoritesSet; },
    set favoritesSet(v) { _favoritesSet = v; },

    get _searchAlbumMatchType() { return _searchAlbumMatchType; },
    set _searchAlbumMatchType(v) { _searchAlbumMatchType = v; },
  };

  /** Build a flat array of all images */
  api.buildAllImgs = function () {
    const all = [];
    for (const img of _rootImages) {
      all.push({ ...img, _key: img.name, _folder: null });
    }
    for (const [folder, imgs] of Object.entries(_albumImages)) {
      for (const img of imgs) {
        all.push({ ...img, _key: folder + '/' + img.name, _folder: folder });
      }
    }
    return all;
  };

  // ========== Nested folder helpers ==========

  /**
   * Get direct child folders under a given parent path.
   * @param {string|null} parentPath - null/'' = root level
   * @returns {string[]}
   */
  api.getChildAlbums = function (parentPath) {
    if (!parentPath) {
      return _albumFolders.filter(f => !f.includes('/'));
    }
    const prefix = parentPath + '/';
    return _albumFolders.filter(f =>
      f.startsWith(prefix) &&
      f.indexOf('/', prefix.length) === -1
    );
  };

  /**
   * Split a relative path into breadcrumb segments.
   * e.g. "vacation/beach" → ["vacation", "beach"]
   * @returns {string[]}
   */
  api.getBreadcrumbSegments = function () {
    if (!_currentView || _currentView === 'all' || _currentView === 'albums') return [];
    return _currentView.split('/');
  };

  /**
   * Get display name from a relative path (last segment).
   */
  api.getDisplayName = function (relPath) {
    const parts = relPath.split('/');
    return parts[parts.length - 1];
  };

  /**
   * Build breadcrumb items with full paths.
   * e.g. ["vacation", "beach"] →
   *   [{name:"全部图片", path:"all"}, {name:"vacation", path:"vacation"}, {name:"beach", path:"vacation/beach"}]
   * @returns {Array<{name:string, path:string}>}
   */
  api.getBreadcrumbItems = function () {
    const segs = api.getBreadcrumbSegments();
    const items = [{ name: '全部图片', path: 'all' }];
    let cur = '';
    for (const seg of segs) {
      cur = cur ? cur + '/' + seg : seg;
      items.push({ name: seg, path: cur });
    }
    return items;
  };

  /** Check if a folder has child sub-folders */
  api.hasChildAlbums = function (folderPath) {
    return api.getChildAlbums(folderPath).length > 0;
  };

  return api;
})();

// Backward-compatible alias
const S = State;
