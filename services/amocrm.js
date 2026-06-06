const axios = require('axios');
const fs = require('fs');
const path = require('path');

const tokensPath = path.join(__dirname, '..', 'tokens.json');

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

async function createContact({ name, phone }) {
  const formattedPhone = formatPhoneForAmo(phone);

  console.log('Создаём контакт:', name, formattedPhone);

  const response = await amoRequest('POST', '/api/v4/contacts', [
    {
      name,
      custom_fields_values: [
        {
          field_code: 'PHONE',
          values: [
            {
              value: formattedPhone,
              enum_code: 'WORK'
            }
          ]
        }
      ]
    }
  ]);

  const contact = response?._embedded?.contacts?.[0];

  console.log('✅ Контакт создан. ID:', contact?.id);

  return contact;
}

async function createLead({ name, contactId }) {
  console.log('Создаём сделку для контакта:', contactId);

  const response = await amoRequest('POST', '/api/v4/leads', [
    {
      name: `Заявка с формы: ${name}`,
      pipeline_id: Number(process.env.AMO_PIPELINE_ID),
      status_id: Number(process.env.AMO_STATUS_ID),
      _embedded: {
        contacts: [
          {
            id: contactId
          }
        ]
      }
    }
  ]);

  const lead = response?._embedded?.leads?.[0];

  console.log('✅ Сделка создана. ID:', lead?.id);

  return lead;
}

async function createContactAndLead(formData) {
  const { name, phone } = formData;

  console.log('Запуск создания контакта и сделки');

  const existingContact = await findContactByPhone(phone);

  if (existingContact) {
    console.log('⛔ Создание остановлено: найден дубль контакта');

    return {
      duplicate: true,
      contact: existingContact
    };
  }

  const contact = await createContact({
    name,
    phone
  });

  const lead = await createLead({
    name,
    contactId: contact.id
  });

  return {
    duplicate: false,
    contact,
    lead
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
  createContactAndLead
};