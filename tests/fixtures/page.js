let controller, xhr;
const output = document.querySelector('#outcome');
document.querySelector('#login').onclick = async () => {
  try { output.textContent = await (await fetch('/login')).text(); } catch (error) { output.textContent = String(error); }
};
document.querySelector('#fetch').onclick = async () => {
  controller = new AbortController();
  try {
    const response = await fetch(document.querySelector('#endpoint').value, { signal: controller.signal });
    output.textContent = `${response.status}: ${await response.text()}`;
  } catch (error) { output.textContent = String(error); }
};
document.querySelector('#xhr').onclick = () => {
  xhr = new XMLHttpRequest(); const events = [];
  for (const type of ['readystatechange', 'loadstart', 'progress', 'load', 'error', 'abort', 'timeout', 'loadend'])
    xhr.addEventListener(type, () => {
      events.push(`${type}:${xhr.readyState}`);
      output.textContent = `${xhr.status}: ${xhr.responseText}\n${events.join(' → ')}`;
    });
  xhr.open('GET', document.querySelector('#endpoint').value);
  xhr.timeout = Number(document.querySelector('#timeout').value); xhr.send();
};
document.querySelector('#abort').onclick = () => { controller?.abort(); xhr?.abort(); };
