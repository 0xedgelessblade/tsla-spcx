(function () {
  const state = { bars: true, ma5: true, ma20: true, cum: true, range: 0 };
  const charts = [];
  let rows = [];
  let syncing = false;

  const UP = "#1f7a45";
  const DOWN = "#b4332a";
  const INK = "#1c1917";
  const MUTED = "#6f675e";
  const LINE = "#e3d9c8";
  const MA5 = "#2b6cb0";
  const MA20 = "#c56a12";
  const CUM = "#6d4ea3";

  function num(value, digits) {
    if (value == null || Number.isNaN(Number(value))) return "—";
    const n = Number(value);
    const body = n.toFixed(digits);
    return (n > 0 ? "+" : "") + body;
  }

  function px(value) {
    if (value == null) return "—";
    return Number(value).toFixed(2);
  }

  function tone(value) {
    if (value == null) return "flat";
    if (value > 0) return "up";
    if (value < 0) return "down";
    return "flat";
  }

  function utcPlus1(iso) {
    const shifted = new Date(new Date(iso).getTime() + 1 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat("zh-Hant-u-nu-latn", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(shifted);
  }

  function card(label, value, extra, className) {
    return (
      '<article class="card"><span>' + label + "</span><b class=\"" +
      (className || "flat") + "\">" + value + "</b>" +
      (extra ? "<small>" + extra + "</small>" : "") + "</article>"
    );
  }

  function tip(date) {
    const row = rows.find((item) => item.date === date);
    if (!row) return date;
    const lines = [
      row.date,
      "TSLA 收盤 " + px(row.tsla) + "　當日 " + num(row.tsla_pct, 2) + "%",
      "SPCX 收盤 " + px(row.spcx) + "　當日 " + num(row.spcx_pct, 2) + "%",
      "當日強勢 " + num(row.daily, 2),
      "累計 " + num(row.cumulative, 2),
      "5 日 " + num(row.ma5, 2) + "　20 日 " + num(row.ma20, 2),
    ];
    return lines.join("<br>");
  }

  function axis() {
    return {
      type: "category",
      data: rows.map((row) => row.date),
      axisLine: { lineStyle: { color: LINE } },
      axisTick: { show: false },
      axisLabel: { color: MUTED, hideOverlap: true },
    };
  }

  function valueAxis(name) {
    return {
      type: "value",
      name: name,
      nameTextStyle: { color: MUTED },
      scale: false,
      axisLabel: { color: MUTED },
      splitLine: { lineStyle: { color: "#efe8dc" } },
    };
  }

  function zoom() {
    return [
      { type: "inside", filterMode: "filter", zoomOnMouseWheel: true, moveOnMouseMove: true },
      {
        type: "slider",
        height: 18,
        bottom: 8,
        filterMode: "filter",
        backgroundColor: "#f7f3ea",
        fillerColor: "rgba(28,25,23,0.12)",
        borderColor: LINE,
        handleStyle: { color: INK, borderColor: INK },
        textStyle: { color: MUTED },
        moveHandleSize: 0,
        showDetail: false,
      },
    ];
  }

  function zeroLine() {
    return {
      silent: true,
      symbol: "none",
      lineStyle: { color: INK, width: 1.2 },
      label: { show: true, formatter: "0", color: MUTED },
      data: [{ yAxis: 0 }],
    };
  }

  function baseOption() {
    return {
      backgroundColor: "transparent",
      textStyle: { fontFamily: "Avenir Next, PingFang TC, sans-serif" },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#fffdf8",
        borderColor: LINE,
        textStyle: { color: INK, fontSize: 13 },
        formatter: function (items) {
          const date = items && items[0] ? items[0].axisValue : "";
          return tip(date);
        },
      },
      grid: { left: 52, right: 36, top: 28, bottom: 46 },
      xAxis: axis(),
      dataZoom: zoom(),
    };
  }

  function applyRange() {
    const count = state.range;
    const start = count ? Math.max(0, (rows.length - count) / rows.length * 100) : 0;
    syncing = true;
    charts.forEach((chart) => {
      chart.dispatchAction({ type: "dataZoom", start: start, end: 100 });
    });
    syncing = false;
  }

  function bindSync(chart) {
    chart.on("datazoom", function () {
      if (syncing) return;
      const option = chart.getOption();
      const dz = option.dataZoom && option.dataZoom[0];
      if (!dz) return;
      syncing = true;
      charts.forEach((other) => {
        if (other !== chart) {
          other.dispatchAction({ type: "dataZoom", start: dz.start, end: dz.end });
        }
      });
      syncing = false;
    });
  }

  function draw() {
    charts.forEach((chart) => chart.dispose());
    charts.length = 0;
    const daily = echarts.init(document.getElementById("chart-daily"));
    const cum = echarts.init(document.getElementById("chart-cum"));
    charts.push(daily, cum);

    daily.setOption(Object.assign(baseOption(), {
      yAxis: valueAxis("百分點"),
      series: [
        {
          name: "當日強勢",
          type: "bar",
          data: state.bars ? rows.map((row) => row.daily) : [],
          itemStyle: {
            color: function (item) { return item.value >= 0 ? UP : DOWN; },
          },
          markLine: zeroLine(),
          barMaxWidth: 12,
        },
        {
          name: "5 日平均",
          type: "line",
          data: state.ma5 ? rows.map((row) => row.ma5) : [],
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 2, color: MA5 },
          itemStyle: { color: MA5 },
        },
        {
          name: "20 日平均",
          type: "line",
          data: state.ma20 ? rows.map((row) => row.ma20) : [],
          showSymbol: false,
          lineStyle: { width: 2, color: MA20 },
          itemStyle: { color: MA20 },
        },
      ],
    }));

    const last = rows.filter((row) => row.cumulative != null).slice(-1)[0];
    cum.setOption(Object.assign(baseOption(), {
      yAxis: valueAxis("百分點"),
      series: [
        {
          name: "累計強勢",
          type: "line",
          data: state.cum ? rows.map((row) => row.cumulative) : [],
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 2.2, color: CUM },
          areaStyle: { color: "rgba(109,78,163,0.12)" },
          itemStyle: { color: CUM },
          markLine: zeroLine(),
          markPoint: last && state.cum ? {
            symbol: "circle",
            symbolSize: 8,
            itemStyle: { color: CUM },
            label: {
              formatter: num(last.cumulative, 2),
              color: CUM,
              position: "left",
            },
            data: [{ coord: [last.date, last.cumulative] }],
          } : undefined,
        },
      ],
    }));

    charts.forEach(bindSync);
    document.getElementById("panel-cum").hidden = !state.cum;
    applyRange();
    charts.forEach((chart) => chart.resize());
  }

  function fillSummary(payload) {
    const strength = rows.filter((row) => row.daily != null);
    const last = strength[strength.length - 1];
    const first = rows[0];
    const end = rows[rows.length - 1];
    const pos = strength.filter((row) => row.daily > 0).length;
    const neg = strength.filter((row) => row.daily < 0).length;
    const tslaRet = (end.tsla / first.tsla - 1) * 100;
    const spcxRet = (end.spcx / first.spcx - 1) * 100;
    document.getElementById("cards").innerHTML = [
      card("最新交易日", last.date, "美股收盤"),
      card("當日強勢", num(last.daily, 2), last.daily >= 0 ? "TSLA 較強" : "TSLA 較弱", tone(last.daily)),
      card("5 日平均", num(last.ma5, 2), "百分點", tone(last.ma5)),
      card("20 日平均", num(last.ma20, 2), "百分點", tone(last.ma20)),
      card("累計強勢", num(last.cumulative, 2), "百分點", tone(last.cumulative)),
      card("較強 / 較弱", pos + " / " + neg, "天"),
      card("上市以來 TSLA", num(tslaRet, 2) + "%", px(first.tsla) + " → " + px(end.tsla), tone(tslaRet)),
      card("上市以來 SPCX", num(spcxRet, 2) + "%", px(first.spcx) + " → " + px(end.spcx), tone(spcxRet)),
    ].join("");
    document.getElementById("updated").textContent =
      "資料截至 " + last.date + " 美股收盤。本頁更新於 " + utcPlus1(payload.generated_at) + " UTC+1。";
  }

  function fillTable() {
    const body = document.querySelector("#table tbody");
    body.innerHTML = rows.slice().reverse().map((row) => {
      return (
        "<tr data-date=\"" + row.date + "\">" +
        "<td>" + row.date + "</td>" +
        "<td>" + px(row.tsla) + "</td>" +
        "<td>" + px(row.spcx) + "</td>" +
        "<td class=\"" + tone(row.tsla_pct) + "\">" + num(row.tsla_pct, 2) + "</td>" +
        "<td class=\"" + tone(row.spcx_pct) + "\">" + num(row.spcx_pct, 2) + "</td>" +
        "<td class=\"" + tone(row.daily) + "\">" + num(row.daily, 2) + "</td>" +
        "<td class=\"" + tone(row.cumulative) + "\">" + num(row.cumulative, 2) + "</td>" +
        "<td>" + num(row.ma5, 2) + "</td>" +
        "<td>" + num(row.ma20, 2) + "</td></tr>"
      );
    }).join("");
    body.addEventListener("click", function (event) {
      const tr = event.target.closest("tr");
      if (!tr || !charts[0]) return;
      charts[0].dispatchAction({
        type: "showTip",
        seriesIndex: 0,
        dataIndex: rows.findIndex((row) => row.date === tr.dataset.date),
      });
    });
  }

  document.getElementById("ranges").addEventListener("click", function (event) {
    const button = event.target.closest("button");
    if (!button) return;
    state.range = Number(button.dataset.range);
    document.querySelectorAll("#ranges button").forEach((item) => {
      const on = item === button;
      item.classList.toggle("on", on);
      item.setAttribute("aria-pressed", on ? "true" : "false");
    });
    applyRange();
  });

  document.getElementById("toggles").addEventListener("click", function (event) {
    const button = event.target.closest("button");
    if (!button) return;
    const key = button.dataset.series;
    state[key] = !state[key];
    button.classList.toggle("on", state[key]);
    button.setAttribute("aria-pressed", state[key] ? "true" : "false");
    draw();
  });

  window.addEventListener("resize", function () {
    charts.forEach((chart) => chart.resize());
  });

  fetch("data/series.json", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("missing");
      return response.json();
    })
    .then((payload) => {
      rows = payload.rows || [];
      if (!rows.length) throw new Error("empty");
      fillSummary(payload);
      fillTable();
      draw();
    })
    .catch(() => {
      document.getElementById("cards").innerHTML = card("資料", "暫時讀不到", "請稍後重新整理");
      document.getElementById("updated").textContent = "公開股價暫時讀不到。舊檔若已下載，仍可用 CSV。";
    });
})();
