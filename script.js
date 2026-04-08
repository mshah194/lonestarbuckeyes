
const contactEmail = "you@example.com"; // TODO: replace with your real email before launch

function sendQuoteRequest(event){
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const subject = encodeURIComponent(`Website Quote Request - ${data.get('projectType') || 'Custom Build'}`);
  const body = encodeURIComponent(
`Name: ${data.get('name')}
Email: ${data.get('email')}
Phone: ${data.get('phone')}
Project Type: ${data.get('projectType')}
City: ${data.get('city')}

Project Details:
${data.get('details')}

Preferred Timeline:
${data.get('timeline')}`
  );
  window.location.href = `mailto:${contactEmail}?subject=${subject}&body=${body}`;
}
document.addEventListener('DOMContentLoaded', () => {
  const year = document.getElementById('year');
  if(year) year.textContent = new Date().getFullYear();
});
