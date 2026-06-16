const form = document.getElementById('leadForm');
const phoneInput = document.getElementById('phone');
const submitButton = document.getElementById('submitButton');
const phoneStatus = document.getElementById('phoneStatus');
const formMessage = document.getElementById('formMessage');

function normalizeRussianPhone(value) {
  let digits = value.replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  if (digits.length === 11 && digits.startsWith('8')) {
    digits = '7' + digits.slice(1);
  }

  if (digits.length === 10) {
    digits = '7' + digits;
  }

  return digits.slice(0, 11);
}

function formatRussianPhone(value) {
  const digits = normalizeRussianPhone(value);

  if (!digits) {
    return '';
  }

  if (digits.length < 11) {
    return value;
  }

  return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
}

function getValue(id) {
  const element = document.getElementById(id);
  return element ? element.value.trim() : '';
}

function setPhoneStatus(type, text) {
  phoneStatus.className = `status ${type}`;
  phoneStatus.textContent = text;
}

function hidePhoneStatus() {
  phoneStatus.className = 'status hidden';
  phoneStatus.textContent = '';
}

function setFormMessage(type, text) {
  formMessage.className = `form-message ${type}`;
  formMessage.textContent = text;
}

function hideFormMessage() {
  formMessage.className = 'form-message hidden';
  formMessage.textContent = '';
}

phoneInput.addEventListener('input', () => {
  hidePhoneStatus();
  hideFormMessage();
  submitButton.disabled = false;
});

phoneInput.addEventListener('blur', async () => {
  const rawPhone = phoneInput.value.trim();
  const normalizedPhone = normalizeRussianPhone(rawPhone);

  hideFormMessage();

  if (!rawPhone) {
    hidePhoneStatus();
    submitButton.disabled = false;
    return;
  }

  if (normalizedPhone.length !== 11) {
    setPhoneStatus('error', 'Введите корректный номер телефона');
    submitButton.disabled = true;
    return;
  }

  phoneInput.value = formatRussianPhone(rawPhone);

  try {
    submitButton.disabled = true;
    setPhoneStatus('checking', 'Проверяем номер в amoCRM...');

    const response = await fetch('/api/check-phone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: normalizedPhone
      })
    });

    const result = await response.json();

    if (result.exists) {
      setPhoneStatus(
        'error',
        'Обнаружен дубль контакта по данному номеру в amoCRM'
      );

      submitButton.disabled = true;
    } else {
      setPhoneStatus(
        'success',
        'Номер свободен, можно создавать сделку'
      );

      submitButton.disabled = false;
    }
  } catch (error) {
    console.error(error);

    setPhoneStatus(
      'error',
      'Не удалось проверить номер. Попробуйте позже.'
    );

    submitButton.disabled = true;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  hideFormMessage();

  const normalizedPhone = normalizeRussianPhone(phoneInput.value);

  if (normalizedPhone.length !== 11) {
    setPhoneStatus('error', 'Введите корректный номер телефона');
    submitButton.disabled = true;
    return;
  }

  const data = {
    name: getValue('name'),
    phone: normalizedPhone,
    age: getValue('age'),
    responsible: getValue('responsible'),
    contactTime: getValue('contactTime'),
    criminalRecord: getValue('criminalRecord'),
    diseases: getValue('diseases'),
    note: getValue('note')
  };

  try {
    submitButton.disabled = true;
    submitButton.textContent = 'Создаём...';

    setFormMessage(
      'success',
      'Отправляем данные в amoCRM...'
    );

    const response = await fetch('/api/create-deal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (!response.ok) {
      setFormMessage(
        'error',
        result.message || 'Ошибка создания сделки'
      );

      submitButton.textContent = 'Создать сделку';
      submitButton.disabled = false;
      return;
    }

    setFormMessage(
      'success',
      'Контакт и сделка успешно созданы в amoCRM'
    );

    form.reset();
    hidePhoneStatus();

  } catch (error) {
    console.error(error);

    setFormMessage(
      'error',
      'Ошибка создания контакта и сделки'
    );
  }

  submitButton.disabled = false;
  submitButton.textContent = 'Создать сделку';
});