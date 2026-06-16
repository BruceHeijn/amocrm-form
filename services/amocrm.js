const axios = require('axios');
const fs = require('fs');
const path = require('path');

const tokensPath = path.join(__dirname, '..', 'tokens.json');

const CONTACT_FIELDS = {
  fullNameText: 1384039,
  age: 1384129,
  criminalRecord: 1384071,
  diseases: 1384075
};

const LEAD_FIELDS = {
  responsible: 1370187,
  contactTime: 801763
};

const RESPONSIBLE_ENUMS = {
  'Вадим Адясов': 1473199,
  'Отдел Кострюковой': 1473201,
  'Отдел Басов': 1473207,
  'Отдел Сосновский': 1473209,
  'Отдел Избякова': 1554907,
  'Отдел Лидеры': 1482165,
  'Общий': 1473273
};

const YES_NO_ENUMS = {
  criminalRecord: {
    'Да': 1481953,
    'Нет': 1481955
  },
  diseases: {
    'Да': 1481959,
    'Нет': 1481961
  }
};

function readTokens() {
  if (!fs.existsSync(tokensPath)) {
    return {
      access_token: '',
      refresh_token: process.env.AMO_REFRESH_TOKEN || ''
    };
  }

  const raw = fs.readFileSync(tokensPath, 'utf8');

  if (!raw.trim()) {
    return {
      access_token: '',
      refresh_token: process.env.AMO_REFRESH_TOKEN || ''
    };
  }

  return JSON.parse(raw);
}

function saveTokens(newTokens) {
  fs.writeFileSync(tokensPath, JSON.stringify(newTokens, null, 2), 'utf8');
}

let tokens = readTokens();
let accessToken = tokens.access_token || null;

function normalizePhone(phone) {
  if (!phone) return '';

  let digits = String(phone).replace(/\D/g, '');

  if (digits.length === 11 && digits.startsWith('8')) {
    digits = '7' + digits.slice(1);
  }

  if (digits.length === 10) {
    digits = '7' + digits;
  }

  return digits;
}

function formatPhoneForAmo(phone) {
  const digits = normalizePhone(phone);

  if (digits.length !== 11 || !digits.startsWith('7')) {
    return phone;
  }

  return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}

function getPhoneSearchVariants(phone) {
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    return [];
  }

  const variants = [
    normalizedPhone,
    `+${normalizedPhone}`
  ];

  if (normalizedPhone.length === 11 && normalizedPhone.startsWith('7')) {
    variants.push(normalizedPhone.slice(1));
  }

  return [...new Set(variants)];
}

function addTextField(fields, fieldId, value) {
  if (value === undefined || value === null || value === '') return;

  fields.push({
    field_id: fieldId,
    values: [{ value: String(value) }]
  });
}

function addEnumField(fields, fieldId, enumId) {
  if (!enumId) return;

  fields.push({
    field_id: fieldId,
    values: [{ enum_id: enumId }]
  });
}

async function refreshAccessToken() {
  console.log('🔄 Обновляем access token...');

  const currentTokens = readTokens();

  if (!currentTokens.refresh_token) {
    throw new Error('В tokens.json отсутствует refresh_token');
  }

  const response = await axios.post(`https://${process.env.AMO_DOMAIN}/oauth2/access_token`, {
    client_id: process.env.AMO_CLIENT_ID,
    client_secret: process.env.AMO_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: currentTokens.refresh_token,
    redirect_uri: process.env.AMO_REDIRECT_URI
  });

  const newTokens = {
    access_token: response.data.access_token,
    refresh_token: response.data.refresh_token
  };

  saveTokens(newTokens);

  tokens = newTokens;
  accessToken = newTokens.access_token;

  console.log('✅ Новый access token получен, tokens.json обновлён');

  return accessToken;
}

async function amoRequest(method, url, data = null, isRetry = false) {
  if (!accessToken) {
    await refreshAccessToken();
  }

  try {
    const response = await axios({
      method,
      url: `https://${process.env.AMO_DOMAIN}${url}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      data
    });

    return response.data;
  } catch (error) {
    const status = error.response?.status;

    if (status === 401 && !isRetry) {
      console.log('⚠️ Access token истёк. Обновляем и повторяем запрос.');

      await refreshAccessToken();

      return amoRequest(method, url, data, true);
    }

    console.error('❌ amoCRM API error:', {
      method,
      url,
      status,
      data: JSON.stringify(error.response?.data, null, 2)
    });

    throw error;
  }
}

async function getAccountInfo() {
  return amoRequest('GET', '/api/v4/account');
}

async function findContactByPhone(phone) {
  const variants = getPhoneSearchVariants(phone);

  if (variants.length === 0) {
    return null;
  }

  console.log('Ищем контакт по вариантам телефона:', variants);

  for (const variant of variants) {
    const result = await amoRequest(
      'GET',
      `/api/v4/contacts?query=${encodeURIComponent(variant)}`
    );

    const contacts = result?._embedded?.contacts || [];

    if (contacts.length > 0) {
      console.log('✅ Контакт найден по варианту:', variant);
      return contacts[0];
    }
  }

  console.log('❌ Контакт не найден ни по одному варианту');

  return null;
}

async function createContact(formData) {
  const { name, phone, age, criminalRecord, diseases } = formData;

  const formattedPhone = formatPhoneForAmo(phone);

  const customFields = [
    {
      field_code: 'PHONE',
      values: [
        {
          value: formattedPhone,
          enum_code: 'WORK'
        }
      ]
    }
  ];

  addTextField(customFields, CONTACT_FIELDS.fullNameText, name);
  addTextField(customFields, CONTACT_FIELDS.age, age);

  addEnumField(
    customFields,
    CONTACT_FIELDS.criminalRecord,
    YES_NO_ENUMS.criminalRecord[criminalRecord]
  );

  addEnumField(
    customFields,
    CONTACT_FIELDS.diseases,
    YES_NO_ENUMS.diseases[diseases]
  );

  console.log('Создаём контакт:', name, formattedPhone);
  console.log('customFields contact:', JSON.stringify(customFields, null, 2));

  const response = await amoRequest('POST', '/api/v4/contacts', [
    {
      name,
      custom_fields_values: customFields
    }
  ]);

  const contact = response?._embedded?.contacts?.[0];

  console.log('✅ Контакт создан. ID:', contact?.id);

  return contact;
}

async function createLead(formData, contactId) {
  const { name, responsible, contactTime } = formData;

  const customFields = [];

  addEnumField(
    customFields,
    LEAD_FIELDS.responsible,
    RESPONSIBLE_ENUMS[responsible]
  );

  addTextField(
    customFields,
    LEAD_FIELDS.contactTime,
    contactTime
  );

  console.log('Создаём сделку для контакта:', contactId);
  console.log('customFields lead:', JSON.stringify(customFields, null, 2));

  const leadData = {
    name: `Заявка с формы: ${name}`,
    pipeline_id: Number(process.env.AMO_PIPELINE_ID),
    status_id: Number(process.env.AMO_STATUS_ID),
    _embedded: {
      contacts: [{ id: contactId }]
    }
  };

  if (customFields.length > 0) {
    leadData.custom_fields_values = customFields;
  }

  const response = await amoRequest('POST', '/api/v4/leads', [leadData]);

  const lead = response?._embedded?.leads?.[0];

  console.log('✅ Сделка создана. ID:', lead?.id);

  return lead;
}

async function createLeadNote(leadId, noteText) {
  if (!noteText || !noteText.trim()) {
    return null;
  }

  console.log('Создаём примечание к сделке:', leadId);

  const response = await amoRequest('POST', `/api/v4/leads/${leadId}/notes`, [
    {
      note_type: 'common',
      params: {
        text: noteText.trim()
      }
    }
  ]);

  const note = response?._embedded?.notes?.[0];

  console.log('✅ Примечание создано. ID:', note?.id);

  return note;
}

async function createContactAndLead(formData) {
  const { phone, note } = formData;

  console.log('Запуск создания контакта и сделки');
  console.log('formData:', JSON.stringify(formData, null, 2));

  const existingContact = await findContactByPhone(phone);

  if (existingContact) {
    console.log('⛔ Создание остановлено: найден дубль контакта');

    return {
      duplicate: true,
      contact: existingContact
    };
  }

  const contact = await createContact(formData);
  const lead = await createLead(formData, contact.id);
  const createdNote = await createLeadNote(lead.id, note);

  return {
    duplicate: false,
    contact,
    lead,
    note: createdNote
  };
}

module.exports = {
  normalizePhone,
  formatPhoneForAmo,
  getPhoneSearchVariants,
  refreshAccessToken,
  amoRequest,
  getAccountInfo,
  findContactByPhone,
  createContact,
  createLead,
  createLeadNote,
  createContactAndLead
};