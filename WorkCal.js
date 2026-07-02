/**
 * WorkCal.gs — the office working calendar and the single source of truth for
 * "productive working time". The timer, workload, capacity and availability
 * calculations ALL go through these functions, so this is the one place that
 * changes when future calendars are added.
 *
 * v1 rules (per the approved spec):
 *   • 7 productive hours/day
 *   • Working days: Monday–Saturday
 *   • 2nd and 4th Saturday of each month are non-working
 *   • Working window (IST): 10:30–18:30 with a 14:00–15:00 break
 *       → productive segments 10:30–14:00 (3.5h) + 15:00–18:30 (3.5h) = 7h
 *
 * Future (Requirement #11) — leave, public holidays, custom calendars, per-
 * employee hours, multiple offices and time zones — extend ONLY this module:
 * make SEGMENTS / isWorkingDay_ parameterised by an optional employee/office,
 * and every consumer inherits the behaviour with no further changes.
 *
 * Note: the Apps Script project timezone is Asia/Kolkata (appsscript.json), so
 * plain Date construction (new Date(y,m,d,h,m)) is already IST — we rely on that.
 */
var WorkCal = (function () {

  // Productive segments as [startMinuteOfDay, endMinuteOfDay). 10:30=630, 14:00=840, 15:00=900, 18:30=1110.
  var SEGMENTS = [[630, 840], [900, 1110]];
  var HOURS_PER_DAY = 7;
  var MIN_PER_DAY = HOURS_PER_DAY * 60;

  /** Mon–Sat, excluding the 2nd and 4th Saturday of the month. */
  function isWorkingDay_(d) {
    var dow = d.getDay();                 // 0 Sun … 6 Sat (script TZ = IST)
    if (dow === 0) return false;          // Sunday off
    if (dow === 6) {                      // Saturday — off on the 2nd & 4th occurrence
      var nth = Math.ceil(d.getDate() / 7);
      if (nth === 2 || nth === 4) return false;
    }
    return true;
  }

  /** Absolute [start,end) Date pairs for a day's productive segments ([] if non-working). */
  function daySegments_(d) {
    if (!isWorkingDay_(d)) return [];
    var y = d.getFullYear(), m = d.getMonth(), da = d.getDate();
    return SEGMENTS.map(function (s) {
      return [new Date(y, m, da, Math.floor(s[0] / 60), s[0] % 60, 0),
              new Date(y, m, da, Math.floor(s[1] / 60), s[1] % 60, 0)];
    });
  }

  function midnight_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  /** Productive minutes between two instants, counting only working segments. */
  function workingMinutesBetween(a, b) {
    a = new Date(a); b = new Date(b);
    if (!(b > a)) return 0;
    var total = 0, cur = midnight_(a), guard = 0;
    while (cur <= b && guard++ < 750) {
      daySegments_(cur).forEach(function (seg) {
        var s = Math.max(a.getTime(), seg[0].getTime());
        var e = Math.min(b.getTime(), seg[1].getTime());
        if (e > s) total += (e - s) / 60000;
      });
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    }
    return Math.round(total);
  }

  /** The instant reached after consuming `hours` of productive time from `from`. */
  function addWorkingHours(from, hours) {
    var remaining = Math.max(0, hours) * 60;   // minutes
    var start = new Date(from), day = midnight_(start), guard = 0;
    if (remaining === 0) return start;
    while (guard++ < 1500) {
      var segs = daySegments_(day);
      for (var i = 0; i < segs.length; i++) {
        var s = Math.max(start.getTime(), segs[i][0].getTime());
        var e = segs[i][1].getTime();
        if (e > s) {
          var avail = (e - s) / 60000;
          if (avail >= remaining) return new Date(s + remaining * 60000);
          remaining -= avail;
        }
      }
      day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      start = day;
    }
    return day; // safety fallback (should not hit within ~4 years)
  }

  /** Productive minutes still available today after `now`. */
  function remainingTodayMin(now) {
    now = new Date(now);
    return workingMinutesBetween(now, new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59));
  }

  return {
    HOURS_PER_DAY: HOURS_PER_DAY,
    MIN_PER_DAY: MIN_PER_DAY,
    isWorkingDay: function (d) { return isWorkingDay_(new Date(d)); },
    workingMinutesBetween: workingMinutesBetween,
    workingHoursBetween: function (a, b) { return workingMinutesBetween(a, b) / 60; },
    addWorkingHours: addWorkingHours,
    remainingTodayMin: remainingTodayMin,
    remainingTodayHours: function (now) { return remainingTodayMin(now) / 60; }
  };
})();

/** Editor self-test — run to sanity-check the calendar. Safe to delete. */
function workCalTest() {
  var out = [];
  var wed10 = new Date(2026, 5, 24, 10, 0);   // Wed 24 Jun 2026, 10:00 (before window)
  var wed19 = new Date(2026, 5, 24, 19, 0);   // same day 19:00 (after window)
  out.push('Full working day 10:00→19:00 (expect 420): ' + WorkCal.workingMinutesBetween(wed10, wed19));
  var sat2 = new Date(2026, 5, 13);           // 13 Jun 2026 is the 2nd Saturday
  out.push('2nd Saturday is working day (expect false): ' + WorkCal.isWorkingDay(sat2));
  var sat1 = new Date(2026, 5, 6);            // 1st Saturday
  out.push('1st Saturday is working day (expect true): ' + WorkCal.isWorkingDay(sat1));
  out.push('addWorkingHours(Wed 10:30, 7h) → ' + WorkCal.addWorkingHours(new Date(2026,5,24,10,30), 7));
  Logger.log(out.join('\n'));
  return out.join('\n');
}
