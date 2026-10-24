// Bags is the only butler. The canonical id is bagheera_butler.agent.
// Other rows are disconnected placeholders, not a second Bags and not a live roster.
window.ORG={personal:{id:'bagheera_butler.agent',name:'Bags',short:'Bags',role:'Personal butler',live:true},
 governance:{id:'gov',name:'Governance (placeholder)',role:'Delegation & routing'},
 ceos:[1,2,3,4].map(n=>({id:'ceo'+n,name:'CEO '+n,role:'Placeholder business',specialists:[1,2].map(k=>['ceo'+n+'-s'+k,'Specialist '+k,'Placeholder'])}))};
