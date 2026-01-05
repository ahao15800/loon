/**
 * Bilibili iOS Sponsor Skip Engine
 * 工程级实现：安全剪裁 DASH 时间轴
 */

/* ================== 基础工具 ================== */

const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 天
let memoryCache = {};

function now() {
  return Date.now();
}

function log(msg) {
  console.log("[BiliSkip]", msg);
}

/* ================== Sponsor 数据 ================== */

function fetchSponsorSegments(bvid) {
  // 你可以替换成自托管 API
  const url = `https://bsbsb.top/api/v1/segments/${bvid}`;

  return new Promise(resolve => {
    // 内存缓存
    if (memoryCache[bvid] && now() - memoryCache[bvid].ts < CACHE_TTL) {
      return resolve(memoryCache[bvid].data);
    }

    $httpClient.get(url, (err, resp, data) => {
      if (err || !data) return resolve([]);

      try {
        const json = JSON.parse(data);
        const segments = json
          .filter(s => s.category === "sponsor")
          .map(s => ({
            start: s.startTime,
            end: s.endTime
          }))
          .sort((a, b) => a.start - b.start);

        memoryCache[bvid] = { ts: now(), data: segments };
        resolve(segments);
      } catch {
        resolve([]);
      }
    });
  });
}

/* ================== 时间轴安全剪裁 ================== */

function safeTrimTimeline(timeline, adSegments) {
  if (!timeline || timeline.length === 0) return timeline;

  return timeline.filter(seg => {
    // seg.start 单位：秒
    for (let ad of adSegments) {
      // 保留广告开始前的关键段
      if (seg.start >= ad.start && seg.start < ad.end) {
        return false;
      }
    }
    return true;
  });
}

/* ================== 主逻辑 ================== */

(async () => {
  let body;
  try {
    body = JSON.parse($response.body);
  } catch {
    $done({ body: $response.body });
    return;
  }

  // 只处理 DASH
  const dash = body?.data?.dash;
  if (!dash || !dash.video || !dash.audio) {
    $done({ body: JSON.stringify(body) });
    return;
  }

  // 跳过 HDR / Dolby / 番剧
  if (dash.dolby || dash.hdr) {
    log("HDR/Dolby bypass");
    $done({ body: JSON.stringify(body) });
    return;
  }

  // 提取 BV
  const match = $request.url.match(/bvid=(BV\w+)/);
  if (!match) {
    $done({ body: JSON.stringify(body) });
    return;
  }
  const bvid = match[1];

  const adSegments = await fetchSponsorSegments(bvid);
  if (!adSegments.length) {
    $done({ body: JSON.stringify(body) });
    return;
  }

  log(`Ad segments found: ${adSegments.length}`);

  try {
    // 裁剪 video
    dash.video.forEach(v => {
      if (v.segment_base?.timeline) {
        v.segment_base.timeline =
          safeTrimTimeline(v.segment_base.timeline, adSegments);
      }
    });

    // 裁剪 audio
    dash.audio.forEach(a => {
      if (a.segment_base?.timeline) {
        a.segment_base.timeline =
          safeTrimTimeline(a.segment_base.timeline, adSegments);
      }
    });
  } catch (e) {
    log("Trim failed, fallback");
    $done({ body: JSON.stringify(body) });
    return;
  }

  $done({ body: JSON.stringify(body) });
})();
