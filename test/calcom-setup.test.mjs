// The Cal.com event type `npm run cal:setup` creates: what the receptionist needs to book a caller who
// only gives a phone number.
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventTypeBody, findEventType } from '../src/providers/calendar/calcom-setup.mjs';

const field = (body, name) => body.bookingFields.find((f) => f.field === name);

test('a caller who only gives a phone number can be booked: phone required, email hidden and optional', () => {
  const body = eventTypeBody();
  assert.deepEqual(field(body, 'attendeePhoneNumber'), { field: 'attendeePhoneNumber', slug: 'attendeePhoneNumber', required: true, hidden: false });
  assert.deepEqual(field(body, 'email'), { field: 'email', slug: 'email', required: false, hidden: true });
});

test('a call-out by default: one hour, 30 minutes for the road after, bookable from one hour ahead', () => {
  const body = eventTypeBody();
  assert.equal(body.title, 'Intervention');
  assert.equal(body.slug, 'intervention');
  assert.equal(body.lengthInMinutes, 60);
  assert.equal(body.afterEventBuffer, 30);
  assert.equal(body.minimumBookingNotice, 60);
});

test('the place is a fixed text, so Cal.com never asks the caller for one', () => {
  const [location] = eventTypeBody().locations;
  assert.equal(location.type, 'address');
  assert.match(location.address, /client/);
});

test('duration, buffer, notice and title can be chosen', () => {
  const body = eventTypeBody({ title: 'Visite de devis', minutes: 30, buffer: 15, notice: 0 });
  assert.equal(body.title, 'Visite de devis');
  assert.equal(body.slug, 'visite-de-devis');
  assert.equal(body.lengthInMinutes, 30);
  assert.equal(body.afterEventBuffer, 15);
  assert.equal(body.minimumBookingNotice, 0);
});

test('an event type already there is found by its slug, so running it again creates nothing', () => {
  const list = [{ id: 11, slug: '30min' }, { id: 42, slug: 'intervention' }];
  assert.equal(findEventType(list, 'intervention')?.id, 42);
  assert.equal(findEventType(list, 'devis'), null);
  assert.equal(findEventType(undefined, 'intervention'), null);
});
