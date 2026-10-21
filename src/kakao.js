// Kakao Maps JavaScript SDK: destination search and landmark lookup.
// The JavaScript key only works from domains registered in Kakao Developers.
const KEY = import.meta.env.VITE_KAKAO_JS_KEY;

let places;
let ready;

export function loadKakao() {
  ready ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KEY}&libraries=services&autoload=false`;
    s.onload = () => window.kakao.maps.load(() => {
      places = new window.kakao.maps.services.Places();
      resolve();
    });
    s.onerror = () => {
      ready = null; // allow a retry on the next search
      reject(new Error('Kakao map service could not load: check the internet connection, or turn off ad blockers for this site'));
    };
    document.head.appendChild(s);
  });
  return ready;
}

async function call(fn, ...args) {
  await loadKakao(); // searching before the SDK has loaded just waits for it
  return new Promise(resolve => {
    fn.call(places, ...args.slice(0, -1), (data, status) => {
      resolve(status === window.kakao.maps.services.Status.OK ? data : []);
    }, args[args.length - 1]);
  });
}

// Places matching what the walker typed, nearest first.
export async function searchPlaces(query, { lat, lng }) {
  await loadKakao();
  const location = new window.kakao.maps.LatLng(lat, lng);
  return call(places.keywordSearch, query, {
    location,
    sort: window.kakao.maps.services.SortBy.DISTANCE,
  });
}

// Categories that make good landmarks, in order of preference.
const LANDMARK_CATEGORIES = ['CS2', 'CE7', 'PM9', 'BK9', 'SW8'];

// The nearest recognisable place within `radius` metres of a turn.
export async function landmarkNear({ lat, lng }, radius = 40) {
  await loadKakao();
  const location = new window.kakao.maps.LatLng(lat, lng);
  const results = await Promise.all(LANDMARK_CATEGORIES.map(code =>
    call(places.categorySearch, code, {
      location,
      radius,
      sort: window.kakao.maps.services.SortBy.DISTANCE,
    })));
  const all = results.flat().map(p => ({
    name: p.place_name,
    category: p.category_group_name,
    distance: Number(p.distance),
  }));
  all.sort((a, b) => a.distance - b.distance);
  return all[0] || null;
}
