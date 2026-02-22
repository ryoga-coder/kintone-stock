(function () {
  'use strict';

  const FC = {
    op: 'operation',
    shipTo: 'shipping_to'
  };

  function applyVisibility(record, isMobile) {
    const op = record[FC.op]?.value;
    const showshipping_to = (op === '出庫'); // 入庫のときは false

    if (isMobile) {
      kintone.mobile.app.record.setFieldShown(FC.shipTo, showshipping_to);
    } else {
      kintone.app.record.setFieldShown(FC.shipTo, showshipping_to);
    }
  }

  // PC
  kintone.events.on([
    'app.record.create.show',
    'app.record.edit.show',
    'app.record.create.change.' + FC.op,
    'app.record.edit.change.' + FC.op
  ], function (event) {
    applyVisibility(event.record, false);
    return event;
  });

  // スマホー
  kintone.events.on([
    'mobile.app.record.create.show',
    'mobile.app.record.edit.show',
    'mobile.app.record.create.change.' + FC.op,
    'mobile.app.record.edit.change.' + FC.op
  ], function (event) {
    applyVisibility(event.record, true);
    return event;
  });

})();
