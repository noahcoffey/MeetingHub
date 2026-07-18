declare module "ical-expander" {
  interface IcalProperty {
    getFirstValue(): unknown;
    getParameter(name: string): string | null;
  }
  interface IcalTime {
    toJSDate(): Date;
  }
  interface IcalEvent {
    uid: string;
    summary: string;
    description: string | null;
    startDate: IcalTime;
    endDate: IcalTime | null;
    attendees: IcalProperty[];
  }
  interface OccurrenceDetails {
    item: IcalEvent;
    startDate: IcalTime;
    endDate: IcalTime | null;
  }
  interface BetweenResult {
    events: IcalEvent[];
    occurrences: OccurrenceDetails[];
  }
  export default class IcalExpander {
    constructor(opts: { ics: string; maxIterations?: number });
    between(after: Date, before: Date): BetweenResult;
    all(): BetweenResult;
  }
}
