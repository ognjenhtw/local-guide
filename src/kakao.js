// Kakao Maps JavaScript SDK: destination search and nearby places.
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

function call(method, ...args) {
  return new Promise(resolve => {
    places[method](...args.slice(0, -1), (data, status) => {
      resolve(status === window.kakao.maps.services.Status.OK ? data : []);
    }, args[args.length - 1]);
  });
}

// Places matching what the walker typed, nearest first.
export async function searchPlaces(query, { lat, lng }) {
  await loadKakao();
  return call('keywordSearch', query, {
    location: new window.kakao.maps.LatLng(lat, lng),
    sort: window.kakao.maps.services.SortBy.DISTANCE,
  });
}

// English names for Kakao's category groups, so the guide can describe places.
const TYPES = {
  MT1: 'supermarket', CS2: 'convenience store', PS3: 'kindergarten', SC4: 'school',
  AC5: 'academy', PK6: 'parking lot', OL7: 'gas station', SW8: 'subway station',
  BK9: 'bank', CT1: 'cultural venue', AG2: 'real estate office', PO3: 'public office',
  AT4: 'attraction', AD5: 'hotel', FD6: 'restaurant', CE7: 'cafe', HP8: 'clinic', PM9: 'pharmacy',
};

// Good landmarks at a corner: big, lit-up signs people notice.
export const LANDMARK_TYPES = ['CS2', 'CE7', 'PM9', 'BK9', 'SW8', 'MT1', 'FD6'];
// Everything worth mentioning when the walker asks what is around them.
export const SURROUNDING_TYPES = ['CS2', 'CE7', 'FD6', 'PM9', 'BK9', 'SW8', 'MT1', 'HP8', 'AT4', 'CT1', 'PO3', 'SC4', 'OL7'];

function normalise(p) {
  // Chains carry their brand as the last part of the category, e.g. "… > 편의점 > GS25".
  const last = p.category_name?.split('>').pop().trim();
  return {
    name: p.place_name,
    brand: last && p.place_name.startsWith(last) ? last : undefined,
    type: TYPES[p.category_group_code] || p.category_name?.split('>').pop().trim(),
    lat: Number(p.y),
    lng: Number(p.x),
    distance: Number(p.distance),
  };
}

// Places matching any of the walker's words within `radius` metres, nearest first.
export async function findNear({ lat, lng }, terms, radius = 150, limit = 6) {
  await loadKakao();
  const location = new window.kakao.maps.LatLng(lat, lng);
  const results = await Promise.all(terms.map(q =>
    call('keywordSearch', q, { location, radius, sort: window.kakao.maps.services.SortBy.DISTANCE })));
  const seen = new Set();
  return results.flat()
    .map(normalise)
    .filter(p => !seen.has(p.name) && seen.add(p.name))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

// Street and neighbourhood at a point, e.g. { street: '와우산로', area: '서교동' }.
export async function areaAt({ lat, lng }) {
  await loadKakao();
  const geocoder = new window.kakao.maps.services.Geocoder();
  return new Promise(resolve => {
    geocoder.coord2Address(lng, lat, (res, status) => {
      if (status !== window.kakao.maps.services.Status.OK || !res[0]) return resolve({});
      const r = res[0];
      resolve({
        street: r.road_address?.road_name,
        area: r.address?.region_3depth_name,
        district: r.address?.region_2depth_name,
      });
    });
  });
}

// Places within `radius` metres of a point, nearest first, at most `limit`.
export async function placesNear({ lat, lng }, radius, types, limit = 10) {
  await loadKakao();
  const location = new window.kakao.maps.LatLng(lat, lng);
  const results = await Promise.all(types.map(code =>
    call('categorySearch', code, { location, radius, sort: window.kakao.maps.services.SortBy.DISTANCE })));
  const seen = new Set();
  return results.flat()
    .map(normalise)
    .filter(p => !seen.has(p.name) && seen.add(p.name))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}
