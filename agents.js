// PUBLIC PREVIEW: placeholder roster only. The real roster is served privately by the backend.
window.ORG={personal:{id:'bags',name:'Bags',role:'Personal butler',live:true},
 governance:{id:'gov',name:'Governance (placeholder)',role:'Delegation & routing'},
 ceos:[1,2,3,4].map(n=>({id:'ceo'+n,name:'CEO '+n,role:'Placeholder business',specialists:[1,2].map(k=>['ceo'+n+'-s'+k,'Specialist '+k,'Placeholder'])}))};
